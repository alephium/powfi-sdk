import type { ExecuteScriptResult } from '@alephium/web3'
import {
  DUST_AMOUNT,
  addressFromContractId,
  subContractId,
  ALPH_TOKEN_ID,
  ONE_ALPH,
  prettifyTokenAmount,
  binToHex,
  addressToBytes
} from '@alephium/web3'
import {
  TokenPair as TokenPairContract,
  SwapMaxIn,
  SwapMinOut,
  AddLiquidity,
  RemoveLiquidity,
  CreatePair,
  CreatePairAndAddLiquidity,
  TokenPairFactory,
  DexAccount
} from 'cpmm/artifacts/ts'
import { loadDeployments } from 'cpmm/artifacts/ts/deployments'
import type { TokenInfo } from '@alephium/token-list'
import { sortTokens } from '../common/utils'
import { MAX_PRICE_IMPACT } from './constants'
import { InsufficientBalanceError, PriceImpactTooHighError, PoolNotFoundError } from '../common/error'
import type {
  CpmmAddLiquidityQuote,
  CpmmAddLiquidityQuoteParams,
  CpmmAddLiquidityRequest,
  CpmmClaimableAmounts,
  CpmmConfig,
  CpmmCreatePoolRequest,
  CpmmPoolContractState,
  CpmmRemoveLiquidityQuote,
  CpmmRemoveLiquidityRequest,
  CpmmSwapQuote,
  CpmmSwapQuoteParams,
  CpmmSwapRequest,
  CpmmCollectProtocolFeesRequest
} from './types'
import type { Powfi } from '../powfi'
import ModuleBase from '../moduleBase'
import BigNumber from 'bignumber.js'
import { MathUtil } from '../common/math'
import { MINIMUM_LIQUIDITY } from './constants'
import { BPS } from '../common/constants'
import { InsufficientLiquidityError } from '../common/error'

/**
 * Provides constant-product AMM (x*y=k) operations for the Alephium Powfi DEX.
 * Handles pool queries, swaps, liquidity management, and quote computations.
 */
export class CpmmModule extends ModuleBase {
  private config: CpmmConfig

  constructor(scope: Powfi) {
    super({ scope, moduleName: 'CpmmModule' })

    this.config = this.getCpmmConfig()
    this.scope = scope
  }

  /** Derives the on-chain contract ID for a token pair, independent of token order. */
  getPoolId(tokenA: string, tokenB: string): string {
    const [token0Id, token1Id] = sortTokens(tokenA, tokenB)
    const path = token0Id + token1Id
    return subContractId(this.config.factoryId, path, this.config.groupIndex)
  }

  /** Converts a token pair's pool ID to its on-chain contract address. */
  getPoolAddress(tokenA: string, tokenB: string): string {
    return addressFromContractId(this.getPoolId(tokenA, tokenB))
  }

  /**
   * Fetches live on-chain pool reserves and metadata for a token pair.
   * @throws {PoolNotFoundError} If the pool contract does not exist on-chain.
   */
  async getPoolState(tokenA: string, tokenB: string): Promise<CpmmPoolContractState> {
    const [token0Id, token1Id] = sortTokens(tokenA, tokenB)
    const token0Info = await this.scope.token.getTokenById(token0Id)
    const token1Info = await this.scope.token.getTokenById(token1Id)

    const poolId = this.getPoolId(tokenA, tokenB)
    const contractAddress = addressFromContractId(poolId)
    const pool = TokenPairContract.at(contractAddress)

    try {
      const state = await pool.fetchState()
      return {
        poolId,
        reserve0: state.fields.reserve0,
        reserve1: state.fields.reserve1,
        token0Info,
        token1Info,
        totalSupply: state.fields.totalSupply,
        dexAccount: state.fields.dexAccount0
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new PoolNotFoundError(poolId)
      }
      this.logAndThrowError(`Failed to fetch pool state on ${poolId}`, error)
    }
  }

  async getPoolProtocolFees(poolAddress: string): Promise<bigint> {
    const pool = TokenPairContract.at(poolAddress)
    const state = await pool.fetchState()
    return state.fields.protocolFees
  }

  async poolExists(tokenA: string, tokenB: string): Promise<boolean> {
    const address = this.getPoolAddress(tokenA, tokenB)

    return this.scope.nodeProvider.addresses
      .getAddressesAddressGroup(address)
      .then((_) => true)
      .catch((e: unknown) => {
        if (e instanceof Error && e.message.indexOf('Group not found') !== -1) {
          return false
        }
        throw e
      })
  }

  async swap(params: CpmmSwapRequest, balances?: Map<string, bigint>): Promise<ExecuteScriptResult> {
    return this.internalSwap(params, balances, false)
  }

  private async internalSwap(
    params: CpmmSwapRequest,
    balances?: Map<string, bigint>,
    bypassPriceImpact = false
  ): Promise<ExecuteScriptResult> {
    if (!this.scope.signer) {
      throw new Error('Signer is required for swap operation')
    }
    if (!params.sender) {
      throw new Error('Sender is required for swap operation')
    }

    const poolState = await this.getPoolState(params.tokenInId, params.tokenOutId)
    const swapDetails = CpmmModule.computeSwapAmount({
      state: poolState,
      tokenInId: params.tokenInId,
      tokenOutId: params.tokenOutId,
      amountIn: params.amountIn,
      amountOut: params.amountOut,
      slippageBps: params.slippageBps ?? 100n // Default 1%
    })

    if (!bypassPriceImpact && swapDetails.priceImpact >= MAX_PRICE_IMPACT) {
      throw new PriceImpactTooHighError(swapDetails.priceImpact, MAX_PRICE_IMPACT)
    }

    if (balances) {
      const available = balances.get(swapDetails.tokenInInfo.id) ?? 0n
      if (available < swapDetails.tokenInAmount) {
        throw new InsufficientBalanceError(
          swapDetails.tokenInInfo.symbol,
          prettifyTokenAmount(swapDetails.tokenInAmount, swapDetails.tokenInInfo.decimals) ??
            `${swapDetails.tokenInAmount}`,
          prettifyTokenAmount(available, swapDetails.tokenInInfo.decimals) ?? `${available}`
        )
      }
    }

    const ttlMinutes = params.ttlMinutes ?? 60

    if (swapDetails.swapType === 'ExactIn') {
      let attoAlphAmount = this.getExtraAlphAmount(swapDetails.state.token0Info.id, swapDetails.state.token1Info.id)
      const tokens: Array<{ id: string; amount: bigint }> = []

      if (swapDetails.tokenInInfo.id === ALPH_TOKEN_ID) {
        attoAlphAmount += swapDetails.tokenInAmount
      } else {
        tokens.push({ id: swapDetails.tokenInInfo.id, amount: swapDetails.tokenInAmount })
      }

      const result = await SwapMinOut.execute({
        signer: this.scope.signer,
        initialFields: {
          dexAccount: poolState.dexAccount,
          sender: params.sender,
          router: this.config.routerId,
          pair: swapDetails.state.poolId,
          tokenInId: swapDetails.tokenInInfo.id,
          amountIn: swapDetails.tokenInAmount,
          amountOutMin: swapDetails.minimalTokenOutAmount!,
          deadline: deadline(ttlMinutes)
        },
        attoAlphAmount,
        tokens
      })
      return result
    } else {
      let attoAlphAmount = this.getExtraAlphAmount(swapDetails.state.token0Info.id, swapDetails.state.token1Info.id)
      const tokens: Array<{ id: string; amount: bigint }> = []

      if (swapDetails.tokenInInfo.id === ALPH_TOKEN_ID) {
        attoAlphAmount += swapDetails.maximalTokenInAmount!
      } else {
        tokens.push({ id: swapDetails.tokenInInfo.id, amount: swapDetails.maximalTokenInAmount! })
      }
      const result = await SwapMaxIn.execute({
        signer: this.scope.signer,
        initialFields: {
          dexAccount: poolState.dexAccount,
          sender: params.sender,
          router: this.config.routerId,
          pair: swapDetails.state.poolId,
          tokenInId: swapDetails.tokenInInfo.id,
          amountInMax: swapDetails.maximalTokenInAmount!,
          amountOut: swapDetails.tokenOutAmount,
          deadline: deadline(ttlMinutes)
        },
        attoAlphAmount,
        tokens
      })
      return result
    }
  }

  async simSwap(params: CpmmSwapRequest): Promise<CpmmSwapQuote> {
    const poolState = await this.getPoolState(params.tokenInId, params.tokenOutId)
    return CpmmModule.computeSwapAmount({
      state: poolState,
      tokenInId: params.tokenInId,
      tokenOutId: params.tokenOutId,
      amountIn: params.amountIn,
      amountOut: params.amountOut,
      slippageBps: params.slippageBps ?? 100n
    })
  }

  async swapTo(params: {
    tokenA: string
    tokenB: string
    targetPrice: number | BigNumber
    sender: string
    slippageBps?: bigint
  }): Promise<ExecuteScriptResult> {
    const state = await this.getPoolState(params.tokenA, params.tokenB)
    const reserve0 = new BigNumber(state.reserve0.toString())
    const reserve1 = new BigNumber(state.reserve1.toString())
    const k = reserve0.times(reserve1)

    // targetP is token1/token0
    const targetP = new BigNumber(params.targetPrice.toString()).times(
      new BigNumber(10).pow(state.token1Info.decimals - state.token0Info.decimals)
    )
    const currentP = reserve1.div(reserve0)

    if (targetP.eq(currentP)) {
      throw new Error('Target price equals current price — nothing to do.')
    }

    const isSellingToken0 = targetP.lt(currentP)
    let amountIn: bigint
    let tokenInId: string
    let tokenOutId: string

    if (isSellingToken0) {
      // targetP = y_new / x_new = (k/x_new) / x_new = k / x_new^2
      // x_new = sqrt(k / targetP)
      const x_new = k.div(targetP).sqrt()
      const dx_virtual = x_new.minus(reserve0)
      amountIn = BigInt(dx_virtual.div(0.997).integerValue(BigNumber.ROUND_CEIL).toString())
      tokenInId = state.token0Info.id
      tokenOutId = state.token1Info.id
    } else {
      // Selling token1 to increase P = y/x
      // 1 / targetP = x_new / y_new = (k/y_new) / y_new = k / y_new^2
      // y_new = sqrt(k * targetP)
      const y_new = k.times(targetP).sqrt()
      const dy_virtual = y_new.minus(reserve1)
      amountIn = BigInt(dy_virtual.div(0.997).integerValue(BigNumber.ROUND_CEIL).toString())
      tokenInId = state.token1Info.id
      tokenOutId = state.token0Info.id
    }

    return this.internalSwap(
      {
        tokenInId,
        tokenOutId,
        amountIn,
        slippageBps: params.slippageBps ?? 50n,
        sender: params.sender
      },
      undefined,
      true
    )
  }

  async addLiquidity(params: CpmmAddLiquidityRequest, balances?: Map<string, bigint>): Promise<ExecuteScriptResult> {
    if (!this.scope.signer) {
      throw new Error('Signer is required for addLiquidity operation')
    }

    const { poolState, tokenAId, tokenBId, amountA, amountB, slippageBps, sender, ttlMinutes = 60 } = params
    const tokenAInfo = CpmmModule.getTokenInfoFromPoolState(poolState, tokenAId, 'tokenAId')
    const tokenBInfo = CpmmModule.getTokenInfoFromPoolState(poolState, tokenBId, 'tokenBId')

    if (amountA === 0n || amountB === 0n) {
      throw new Error('The input amount must be greater than 0')
    }

    if (balances) {
      const tokenAAvailable = balances.get(tokenAInfo.id) ?? 0n
      if (tokenAAvailable < amountA) {
        throw new InsufficientBalanceError(
          tokenAInfo.symbol,
          prettifyTokenAmount(amountA, tokenAInfo.decimals) ?? `${amountA}`,
          prettifyTokenAmount(tokenAAvailable, tokenAInfo.decimals) ?? `${tokenAAvailable}`
        )
      }

      const tokenBAvailable = balances.get(tokenBInfo.id) ?? 0n
      if (tokenBAvailable < amountB) {
        throw new InsufficientBalanceError(
          tokenBInfo.symbol,
          prettifyTokenAmount(amountB, tokenBInfo.decimals) ?? `${amountB}`,
          prettifyTokenAmount(tokenBAvailable, tokenBInfo.decimals) ?? `${tokenBAvailable}`
        )
      }
    }

    const isInitial = poolState.reserve0 === 0n && poolState.reserve1 === 0n
    const amountAMin = isInitial ? amountA : CpmmModule.minimalAmount(amountA, slippageBps)
    const amountBMin = isInitial ? amountB : CpmmModule.minimalAmount(amountB, slippageBps)

    const [amount0Desired, amount1Desired, amount0Min, amount1Min] =
      tokenAId === poolState.token0Info.id
        ? [amountA, amountB, amountAMin, amountBMin]
        : [amountB, amountA, amountBMin, amountAMin]

    // Calculate ALPH amounts properly
    const extraAlph = this.getExtraAlphAmount(tokenAId, tokenBId)
    let attoAlphAmount = extraAlph + DUST_AMOUNT
    const tokens: Array<{ id: string; amount: bigint }> = []

    // Handle ALPH token properly - don't double count it
    if (tokenAId === ALPH_TOKEN_ID) {
      attoAlphAmount += amountA
      tokens.push({ id: tokenBId, amount: amountB })
    } else if (tokenBId === ALPH_TOKEN_ID) {
      attoAlphAmount += amountB
      tokens.push({ id: tokenAId, amount: amountA })
    } else {
      tokens.push({ id: tokenAId, amount: amountA }, { id: tokenBId, amount: amountB })
    }

    const result = await AddLiquidity.execute({
      signer: this.scope.signer,
      initialFields: {
        sender,
        router: this.config.routerId,
        pair: poolState.poolId,
        amount0Desired,
        amount1Desired,
        amount0Min,
        amount1Min,
        deadline: deadline(ttlMinutes)
      },
      attoAlphAmount,
      tokens
    })
    return result
  }

  /** Removes liquidity from a pool and returns the underlying tokens to the sender. */
  async removeLiquidity(params: CpmmRemoveLiquidityRequest): Promise<ExecuteScriptResult> {
    if (!this.scope.signer) {
      throw new Error('Signer is required for removeLiquidity operation')
    }

    const { poolState, liquidity, totalLiquidityAmount, slippageBps, sender, ttlMinutes = 60 } = params
    const ownedLiquidity = totalLiquidityAmount ?? poolState.totalSupply
    const details = CpmmModule.computeRemoveLiquidityAmounts(poolState, ownedLiquidity, liquidity)

    const amount0Min = CpmmModule.minimalAmount(details.amount0, slippageBps)
    const amount1Min = CpmmModule.minimalAmount(details.amount1, slippageBps)

    const result = await RemoveLiquidity.execute({
      signer: this.scope.signer,
      initialFields: {
        sender,
        router: this.config.routerId,
        pairId: poolState.poolId,
        liquidity,
        amount0Min,
        amount1Min,
        deadline: deadline(ttlMinutes)
      },
      attoAlphAmount: this.getExtraAlphAmount(poolState.token0Info.id, poolState.token1Info.id) + DUST_AMOUNT,
      tokens: [{ id: poolState.poolId, amount: liquidity }]
    })
    return result
  }

  /** Fetches pool state then computes the token amounts claimable for a given liquidity position. */
  async computeClaimableAmounts(
    tokenAId: string,
    tokenBId: string,
    liquidityBalance: bigint
  ): Promise<CpmmClaimableAmounts> {
    const state = await this.getPoolState(tokenAId, tokenBId)
    const details = CpmmModule.computeClaimableAmounts(state, liquidityBalance)
    return {
      token0: details.token0,
      amount0: details.amount0,
      token1: details.token1,
      amount1: details.amount1
    }
  }

  /** Creates a new CPMM pool on-chain, optionally seeded with initial liquidity. */
  async createPool(params: CpmmCreatePoolRequest): Promise<ExecuteScriptResult & { poolId: string }> {
    if (!this.scope.signer) {
      throw new Error('Signer is required for createPool operation')
    }

    const { tokenAId, tokenBId, sender, initialLiquidity } = params
    const poolId = this.getPoolId(tokenAId, tokenBId)

    if (initialLiquidity) {
      const { tokenAAmount, tokenBAmount } = initialLiquidity
      const [token0Id, token1Id] = sortTokens(tokenAId, tokenBId)
      const [amount0, amount1] = token0Id === tokenAId ? [tokenAAmount, tokenBAmount] : [tokenBAmount, tokenAAmount]
      const state = await TokenPairFactory.at(addressFromContractId(this.config.factoryId)).fetchState()

      const result = await CreatePairAndAddLiquidity.execute({
        signer: this.scope.signer,
        initialFields: {
          payer: sender,
          factory: this.config.factoryId,
          alphAmount: ONE_ALPH,
          token0Id,
          token1Id,
          amount0,
          amount1,
          dexAccount: state.fields.dexAccount0
        },
        attoAlphAmount: ONE_ALPH + this.getExtraAlphAmount(tokenAId, tokenBId),
        tokens: [
          { id: token0Id, amount: amount0 },
          { id: token1Id, amount: amount1 }
        ]
      })
      return { ...result, poolId }
    }

    const result = await CreatePair.execute({
      signer: this.scope.signer,
      initialFields: {
        payer: sender,
        factory: this.config.factoryId,
        alphAmount: ONE_ALPH,
        tokenAId,
        tokenBId
      },
      attoAlphAmount: ONE_ALPH + this.getExtraAlphAmount(tokenAId, tokenBId),
      tokens: [
        { id: tokenAId, amount: 1n },
        { id: tokenBId, amount: 1n }
      ]
    })
    return { ...result, poolId }
  }

  getCollectProtocolFeesData(tokenAId: string, tokenBId: string): string {
    const [token0Id, token1Id] = sortTokens(tokenAId, tokenBId)
    return token0Id + token1Id
  }

  async collectProtocolFees(params: CpmmCollectProtocolFeesRequest): Promise<ExecuteScriptResult> {
    const data = this.getCollectProtocolFeesData(params.tokenAId, params.tokenBId)
    return await this.scope.staking.collectProtocolFees(this.config.factoryId, data, data)
  }

  async setFeeCollector(): Promise<ExecuteScriptResult> {
    const factory = TokenPairFactory.at(addressFromContractId(this.config.factoryId))
    const newFeeCollector = addressFromContractId(this.scope.staking.getConfig().feeCollectorId)
    return factory.transact.updateFeeCollector({
      signer: this.scope.signer,
      args: { newFeeCollector }
    })
  }

  async migrateFactory(newBytecode: string): Promise<ExecuteScriptResult> {
    const factory = TokenPairFactory.at(addressFromContractId(this.config.factoryId))
    return await factory.transact.upgrade({
      signer: this.scope.signer,
      args: { newBytecode }
    })
  }

  async migratePool(tokenA: string, tokenB: string, newBytecode: string): Promise<ExecuteScriptResult> {
    const factory = TokenPairFactory.at(addressFromContractId(this.config.factoryId))
    const [token0Id, token1Id] = sortTokens(tokenA, tokenB)
    return await factory.transact.upgradeTokenPair({
      signer: this.scope.signer,
      args: {
        newBytecode,
        token0Id,
        token1Id
      }
    })
  }

  async migrateDexAccount(newBytecode: string): Promise<ExecuteScriptResult> {
    const signerAccount = await this.scope.signer.getSelectedAccount()
    const accountId = await this.getDexAccountId(signerAccount.address)
    const account = DexAccount.at(addressFromContractId(accountId))
    return await account.transact.upgrade({
      signer: this.scope.signer,
      args: { newCode: newBytecode, path: '' }
    })
  }

  async getAccountRoot(): Promise<string> {
    if (this.config.accountRoot) {
      return this.config.accountRoot
    }
    const factory = TokenPairFactory.at(addressFromContractId(this.config.factoryId))
    const state = await factory.fetchState()
    return state.fields.dexAccount0
  }

  async getDexAccountId(owner: string): Promise<string> {
    const group = this.config.groupIndex
    const path = binToHex(addressToBytes(owner))
    const accountRoot = await this.getAccountRoot()
    return subContractId(accountRoot, path, group)
  }

  getCpmmConfig(): CpmmConfig {
    const networkId = this.scope.network.id
    try {
      const deployments = loadDeployments(networkId)
      return {
        groupIndex: deployments.contracts.Router.contractInstance.groupIndex,
        factoryId: deployments.contracts.TokenPairFactory.contractInstance.contractId,
        routerId: deployments.contracts.Router.contractInstance.contractId
      }
    } catch (error) {
      this.logAndThrowError(`Failed to load deployments on ${networkId}`, error)
    }
  }

  /**
   * Computes swap output amount, price impact, and slippage bounds for a given input or output.
   * Supports both exact-in and exact-out swap modes.
   */
  static computeSwapAmount(params: CpmmSwapQuoteParams): CpmmSwapQuote {
    const { state, tokenInId, tokenOutId, amountIn, amountOut, slippageBps } = params
    const tokenInInfo = this.getTokenInfoFromPoolState(state, tokenInId, 'tokenInId')
    const tokenOutInfo = this.getTokenInfoFromPoolState(state, tokenOutId, 'tokenOutId')

    let swapType: 'ExactIn' | 'ExactOut'
    let tokenInAmount: bigint
    let tokenOutAmount: bigint

    if (amountIn !== undefined) {
      swapType = 'ExactIn'
      tokenInAmount = amountIn
      tokenOutAmount = CpmmModule.getAmountOut(state, tokenInInfo.id, amountIn)
    } else if (amountOut !== undefined) {
      swapType = 'ExactOut'
      tokenInAmount = CpmmModule.getAmountIn(state, tokenOutInfo.id, amountOut)
      tokenOutAmount = amountOut
    } else {
      throw new Error('Either amountIn or amountOut must be specified')
    }

    const priceImpact = this.calcPriceImpact(
      state.reserve0,
      state.reserve1,
      tokenInInfo.id,
      state.token0Info.id,
      tokenInAmount,
      tokenOutAmount
    )

    return {
      swapType,
      state,
      tokenInInfo,
      tokenOutInfo,
      tokenInAmount,
      tokenOutAmount,
      priceImpact,
      minimalTokenOutAmount: swapType === 'ExactIn' ? this.minimalAmount(tokenOutAmount, slippageBps) : undefined,
      maximalTokenInAmount: swapType === 'ExactOut' ? this.maximalAmount(tokenInAmount, slippageBps) : undefined
    }
  }

  /**
   * Computes add-liquidity amounts and pool share for both initial and existing pools.
   * For initial pools, both amounts are required; for existing pools, the other amount is derived from reserves.
   */
  static computeLiquidityAmounts(params: CpmmAddLiquidityQuoteParams): CpmmAddLiquidityQuote {
    const { poolState, tokenAId, tokenBId, amountA, amountB, inputType = 'TokenA' } = params

    if (!poolState) {
      // Initial liquidity
      if (amountA === undefined || amountB === undefined) {
        throw new Error('Both amountA and amountB are required for initial liquidity')
      }
      return this.getInitLiquidityDetails(tokenAId, tokenBId, amountA, amountB)
    }

    // Adding to existing pool
    const inputTokenId = inputType === 'TokenA' ? tokenAId : tokenBId
    const inputAmount = inputType === 'TokenA' ? amountA : amountB

    if (inputAmount === undefined) {
      throw new Error(`Amount for ${inputType} is required`)
    }

    return this.getLiquidityDetails(poolState, inputTokenId, inputAmount, inputType)
  }

  /** Computes the token amounts returned when removing a given amount of liquidity from a pool. */
  static computeRemoveLiquidityAmounts(
    state: CpmmPoolContractState,
    totalLiquidity: bigint,
    liquidityToRemove: bigint
  ): CpmmRemoveLiquidityQuote {
    if (liquidityToRemove > totalLiquidity) {
      throw new Error('Liquidity exceeds total liquidity amount')
    }

    const amount0 = (liquidityToRemove * state.reserve0) / state.totalSupply
    const amount1 = (liquidityToRemove * state.reserve1) / state.totalSupply
    const remainShareAmount = totalLiquidity - liquidityToRemove
    const remainPoolLiquidity = state.totalSupply - liquidityToRemove
    const remainSharePercentage = BigNumber((100n * remainShareAmount).toString())
      .div(BigNumber(remainPoolLiquidity.toString()))
      .toFixed(5)

    return {
      state: state,
      token0: state.token0Info,
      amount0,
      token1: state.token1Info,
      amount1,
      remainShareAmount,
      remainSharePercentage: parseFloat(remainSharePercentage)
    }
  }

  /** Computes the full position value (both token amounts) for a given liquidity balance. */
  static computeClaimableAmounts(state: CpmmPoolContractState, liquidityBalance: bigint): CpmmRemoveLiquidityQuote {
    return this.computeRemoveLiquidityAmounts(state, liquidityBalance, liquidityBalance)
  }

  /**
   * Applies negative slippage to compute the minimum acceptable amount.
   * @param slippage - Slippage tolerance in basis points (1 bps = 0.01%).
   */
  static minimalAmount(amount: bigint, slippage: bigint): bigint {
    this.assertSlippageInRange(slippage)
    return (amount * BPS) / (BPS + slippage)
  }

  /**
   * Applies positive slippage to compute the maximum required amount.
   * @param slippage - Slippage tolerance in basis points (1 bps = 0.01%).
   */
  static maximalAmount(amount: bigint, slippage: bigint): bigint {
    this.assertSlippageInRange(slippage)
    return (amount * (BPS + slippage) + (BPS - 1n)) / BPS
  }

  private static assertSlippageInRange(slippage: bigint): void {
    if (slippage < 0n || slippage >= BPS) {
      throw new Error(`Slippage must satisfy 0 <= slippage < ${BPS}, received ${slippage}`)
    }
  }

  /** Calculates the price impact percentage of a swap relative to the current pool reserves. */
  static calcPriceImpact(
    reserve0: bigint,
    reserve1: bigint,
    tokenInId: string,
    token0Id: string,
    amountIn: bigint,
    amountOut: bigint
  ): number {
    const [reserveIn, reserveOut] = token0Id === tokenInId ? [reserve0, reserve1] : [reserve1, reserve0]
    const numerator = (reserveOut * (reserveIn + amountIn) - (reserveOut - amountOut) * reserveIn) * 100n
    const denumerator = reserveIn * (reserveOut - amountOut)
    const impact = new BigNumber(numerator.toString()).div(new BigNumber(denumerator.toString())).toFixed()
    return parseFloat(impact)
  }

  /** Computes the add-liquidity quote for an existing pool, deriving the paired amount from reserves. */
  static getLiquidityDetails(
    state: CpmmPoolContractState,
    inputTokenId: string,
    inputAmount: bigint,
    inputType: 'TokenA' | 'TokenB' // First or second token in the token input box
  ): CpmmAddLiquidityQuote {
    const isInputToken0 = inputTokenId === state.token0Info.id
    const [reserveA, reserveB] = isInputToken0 ? [state.reserve0, state.reserve1] : [state.reserve1, state.reserve0]

    const outputAmount = (inputAmount * reserveB) / reserveA
    const liquidityA = (inputAmount * state.totalSupply) / reserveA
    const liquidityB = (outputAmount * state.totalSupply) / reserveB
    const liquidity = liquidityA < liquidityB ? liquidityA : liquidityB
    const totalSupply = state.totalSupply + liquidity
    const percentage = BigNumber((100n * liquidity).toString())
      .div(BigNumber(totalSupply.toString()))
      .toFixed(5)
    const sharePercentage = parseFloat(percentage)
    const outputTokenId = isInputToken0 ? state.token1Info.id : state.token0Info.id

    const [tokenAId, tokenBId] = inputType === 'TokenA' ? [inputTokenId, outputTokenId] : [outputTokenId, inputTokenId]
    const [amountA, amountB] = inputType === 'TokenA' ? [inputAmount, outputAmount] : [outputAmount, inputAmount]
    return { state, tokenAId, tokenBId, amountA, amountB, shareAmount: liquidity, sharePercentage }
  }

  /**
   * Computes the input amount needed for a desired output using the x*y=k formula with a 0.3% fee.
   * @throws {InsufficientLiquidityError} If the desired output exceeds pool reserves.
   */
  static getAmountIn(state: CpmmPoolContractState, tokenOutId: string, amountOut: bigint): bigint {
    const [tokenOutInfo, reserveIn, reserveOut] =
      tokenOutId === state.token0Info.id
        ? [state.token0Info, state.reserve1, state.reserve0]
        : [state.token1Info, state.reserve0, state.reserve1]

    if (amountOut >= reserveOut) {
      throw new InsufficientLiquidityError(
        `Amount must be less than reserve, amount: ${prettifyTokenAmount(amountOut, tokenOutInfo.decimals)}, reserve: ${prettifyTokenAmount(reserveOut, tokenOutInfo.decimals)}`
      )
    }
    const numerator = reserveIn * amountOut * 1000n
    const denominator = (reserveOut - amountOut) * 997n
    return numerator / denominator + 1n
  }

  /** Computes the output amount for a given input using the x*y=k formula with a 0.3% fee. */
  static getAmountOut(state: CpmmPoolContractState, tokenInId: string, amountIn: bigint): bigint {
    if (tokenInId === state.token0Info.id) {
      return this._getAmountOut(amountIn, state.reserve0, state.reserve1)
    } else {
      return this._getAmountOut(amountIn, state.reserve1, state.reserve0)
    }
  }

  /**
   * Computes the initial liquidity pool share for a new pool.
   * @throws {InsufficientLiquidityError} If the geometric mean of the amounts is below the minimum liquidity threshold.
   */
  static getInitLiquidityDetails(
    tokenAId: string,
    tokenBId: string,
    amountA: bigint,
    amountB: bigint
  ): CpmmAddLiquidityQuote {
    const liquidity = MathUtil.sqrt(amountA * amountB)
    if (liquidity <= MINIMUM_LIQUIDITY) {
      throw new InsufficientLiquidityError('Insufficient initial liquidity')
    }
    return {
      tokenAId,
      tokenBId,
      amountA,
      amountB,
      shareAmount: liquidity - MINIMUM_LIQUIDITY,
      sharePercentage: 100
    }
  }

  private static getTokenInfoFromPoolState(
    state: CpmmPoolContractState,
    tokenId: string,
    tokenLabel: string
  ): TokenInfo {
    if (state.token0Info.id === tokenId) {
      return state.token0Info
    }
    if (state.token1Info.id === tokenId) {
      return state.token1Info
    }
    throw new Error(`Unknown ${tokenLabel} ${tokenId} for pool ${state.poolId}`)
  }

  private static _getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
    const amountInExcludeFee = 997n * amountIn
    const numerator = amountInExcludeFee * reserveOut
    const denominator = amountInExcludeFee + 1000n * reserveIn
    return numerator / denominator
  }

  private getExtraAlphAmount(tokenAId: string, tokenBId: string): bigint {
    if (tokenAId === ALPH_TOKEN_ID || tokenBId === ALPH_TOKEN_ID) {
      return DUST_AMOUNT * 2n
    }
    return DUST_AMOUNT * 3n
  }
}

function deadline(ttlInMinutes: number): bigint {
  return BigInt(Date.now() + ttlInMinutes * 60 * 1000)
}
