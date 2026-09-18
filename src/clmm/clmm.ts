import type { ExecuteScriptResult, SignExecuteScriptTxResult, Token } from '@alephium/web3'
import {
  ALPH_TOKEN_ID,
  addressFromContractId,
  binToHex,
  DUST_AMOUNT,
  MINIMAL_CONTRACT_DEPOSIT,
  subContractId,
  codec,
  encodePrimitiveValues,
  groupOfAddress,
  addressToBytes
} from '@alephium/web3'
import { loadDeployments } from 'clmm/artifacts/ts/deployments'
import ModuleBase from '../moduleBase'
import type { Powfi } from '../powfi'
import type {
  ClmmAddLiquidityRequest,
  ClmmConfig,
  ClmmCollectProtocolFeesRequest,
  ClmmCollectTokensRequest,
  ClmmExtendRewardsRequest,
  ClmmSimulateSwapQuote,
  ClmmPositionInfoRequest,
  ClmmPoolContractState,
  ClmmPoolConfig,
  ClmmSetRewardParamsRequest,
  ClmmSimulateSwapParams,
  ClmmSwapRequest,
  ClmmSwapToRequest,
  ClmmRemoveLiquidityRequest,
  ClmmPositionInfo,
  ClmmPoolRewardState
} from './types'
import type {
  DexAccountRootInstance,
  PoolInstance,
  PoolTypes,
  PositionManagerInstance,
  PositionManagerTypes
} from 'clmm/artifacts/ts'
import {
  CreateLiquidPool,
  Pool,
  PoolConfig,
  PoolFactory,
  DexAccount,
  DexAccountRoot,
  PositionManager,
  SwapWithoutAccount,
  SwapWithoutAccountWithFee
} from 'clmm/artifacts/ts'
import { PoolUtils } from './pool'
import { TickUtils } from './tick'
import { ClmmLiquidityUtils } from './liquidity'
import { normalizeAddress, PoolNotFoundError, sortTokens, validateIntegratorFee } from '../common'

/**
 * Provides operations for Alephium's concentrated liquidity AMM (Uniswap V3-style).
 * Handles pool creation, liquidity management, swaps, position tracking, and farming rewards.
 */
export class ClmmModule extends ModuleBase {
  private config: ClmmConfig
  private configsByIndex = new Map<bigint, ClmmPoolConfig>()

  constructor(scope: Powfi) {
    super({ scope, moduleName: 'ClmmModule' })

    this.config = this.getConfig()
  }

  /** Overrides the CLMM deployment configuration (factory, position manager, etc.). */
  setConfig(config: ClmmConfig) {
    this.config = config
  }

  /** Returns the current CLMM deployment configuration. */
  getClmmConfig(): ClmmConfig {
    return this.config
  }

  /** Derives the on-chain contract ID of a pool fee tier configuration from its index. */
  getPoolConfigId(configIndex: bigint): string {
    const rawIndex = codec.u256Codec.encode(configIndex)
    const configPath = binToHex(rawIndex)
    const group = this.config.groupIndex
    return subContractId(this.config.factoryId, configPath, group)
  }

  /** Fetches all fee tier configurations registered in the factory. Results are cached per index. */
  async getAllPoolConfigs(): Promise<ClmmPoolConfig[]> {
    const factoryAddress = addressFromContractId(this.config.factoryId)
    const factory = PoolFactory.at(factoryAddress)
    const state = await factory.fetchState()
    const nextConfigIndex = state.fields.nextConfigIndex

    const configs: ClmmPoolConfig[] = []
    for (let i = 0n; i < nextConfigIndex; i++) {
      let config = this.configsByIndex.get(i)
      if (!config) {
        config = await this.fetchConfigFromChain(i)
        this.configsByIndex.set(i, config)
      }
      configs.push(config)
    }

    return configs
  }

  /**
   * Fetches a single fee tier configuration by index, returning from cache if available.
   * @returns The pool config, or `undefined` if the index does not exist on-chain.
   */
  async getPoolConfig(configIndex: bigint): Promise<ClmmPoolConfig | undefined> {
    const cached = this.configsByIndex.get(configIndex)
    if (cached) {
      return cached
    }

    try {
      const config = await this.fetchConfigFromChain(configIndex)
      this.configsByIndex.set(configIndex, config)
      return config
    } catch (error) {
      this.logWarning(`Failed to fetch config ${configIndex.toString()}`, error)
      return undefined
    }
  }

  private async fetchConfigFromChain(configIndex: bigint): Promise<ClmmPoolConfig> {
    const poolConfigId = this.getPoolConfigId(configIndex)
    const poolConfigAddress = addressFromContractId(poolConfigId)
    const poolConfig = PoolConfig.at(poolConfigAddress)
    const poolConfigState = await poolConfig.fetchState()
    return {
      configIndex,
      tickSpacing: poolConfigState.fields.config.tickSpacing,
      tradingFee: poolConfigState.fields.config.fee,
      protocolFee: poolConfigState.fields.config.feeProtocol
    }
  }

  /**
   * Fetches live pool state including current liquidity, tick, sqrtPriceX96, and token metadata.
   * @throws {PoolNotFoundError} If no pool exists for the given ID.
   */
  async getPoolState(poolId: string): Promise<ClmmPoolContractState> {
    try {
      const poolAddress = addressFromContractId(poolId)
      const pool = Pool.at(poolAddress)
      const state = await pool.fetchState()
      const token0Info = await this.scope.token.getTokenById(state.fields.token0)
      const token1Info = await this.scope.token.getTokenById(state.fields.token1)

      return {
        poolId,
        token0Info,
        token1Info,
        liquidity: state.fields.liquidity,
        tradingFee: state.fields.fee,
        protocolFee: state.fields.slot0.feeProtocol,
        tick: state.fields.slot0.tick,
        tickSpacing: state.fields.tickSpacing,
        sqrtPriceX96: state.fields.slot0.sqrtPriceX96,
        configIndex: state.fields.configIndex
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new PoolNotFoundError(poolId)
      }
      this.logAndThrowError(`Failed to fetch CLMM pool state on ${poolId}`, error)
    }
  }

  async getPoolProtocolFees(poolId: string): Promise<{ token0: bigint; token1: bigint }> {
    const pool = Pool.at(addressFromContractId(poolId))
    const state = await pool.fetchState()
    return {
      token0: state.fields.protocolFees.token0,
      token1: state.fields.protocolFees.token1
    }
  }

  async getPoolRewardState(poolId: string): Promise<ClmmPoolRewardState> {
    try {
      const poolAddress = addressFromContractId(poolId)
      const pool = Pool.at(poolAddress)
      const state = await pool.fetchState()
      const token2Info = await this.scope.token.getTokenById(state.fields.token2)

      const rewardInfos = state.fields.rewardInfos.map((r) => ({
        amount: r.amount,
        openTime: r.nextOpenTime,
        endTime: r.endTime
      }))

      return {
        token2Info,
        rewardInfos
      }
    } catch (error) {
      this.logAndThrowError(`Failed to fetch CLMM pool reward state for ${poolId}`, error)
    }
  }

  async getPoolTokenBalances(poolId: string): Promise<{ token0Balance: bigint; token1Balance: bigint }> {
    try {
      const poolAddress = addressFromContractId(poolId)
      const state = await Pool.at(poolAddress).fetchState()
      const { token0, token1 } = state.fields

      const balance = await this.scope.nodeProvider.addresses.getAddressesAddressBalance(poolAddress)
      const getBalance = (tokenId: string) =>
        tokenId === ALPH_TOKEN_ID
          ? BigInt(balance.balance)
          : BigInt(balance.tokenBalances?.find((t) => t.id === tokenId)?.amount || '0')

      return {
        token0Balance: getBalance(token0),
        token1Balance: getBalance(token1)
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new PoolNotFoundError(poolId)
      }
      this.logAndThrowError(`Failed to fetch CLMM pool token balances for ${poolId}`, error)
    }
  }

  /** Derives the pool contract ID for a token pair and fee tier. Tokens are sorted internally. */
  getPoolId(tokenA: string, tokenB: string, configIndex: bigint): string {
    const [token0, token1] = sortTokens(tokenA, tokenB)
    const group = this.config.groupIndex
    const factoryId = this.config.factoryId
    const rawIndex = codec.u256Codec.encode(configIndex)
    const configPath = binToHex(rawIndex)
    const configId = subContractId(factoryId, configPath, group)
    const path = token0 + token1 + configId
    return subContractId(factoryId, path, group)
  }

  /** Derives a position's contract ID from the pool, owner address, and tick range. */
  getPositionId(poolId: string, owner: string, tickLower: bigint, tickUpper: bigint): string {
    const group = groupOfAddress(addressFromContractId(poolId))
    const path = encodePrimitiveValues([
      { type: 'U256', value: Pool.consts.PathPrefixes.Position },
      { type: 'Address', value: owner },
      { type: 'I256', value: tickLower },
      { type: 'I256', value: tickUpper }
    ])
    return subContractId(poolId, binToHex(path), group)
  }

  /** Returns the contract address for a pool identified by token pair and fee tier. */
  getPoolAddress(tokenA: string, tokenB: string, configIndex: bigint): string {
    const poolId = this.getPoolId(tokenA, tokenB, configIndex)
    return addressFromContractId(poolId)
  }

  /** Returns a Pool contract instance for the given token pair and fee tier. */
  getPool(tokenA: string, tokenB: string, configIndex: bigint): PoolInstance {
    const poolAddress = this.getPoolAddress(tokenA, tokenB, configIndex)
    return Pool.at(poolAddress)
  }

  /** Checks whether a pool exists on-chain for the given token pair and fee tier. */
  async poolExists(tokenA: string, tokenB: string, configIndex: bigint): Promise<boolean> {
    const poolAddress = this.getPoolAddress(tokenA, tokenB, configIndex)
    const pool = Pool.at(poolAddress)
    try {
      await pool.fetchState()
      return true
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return false
      }
      this.logAndThrowError(`Failed to fetch pool state on ${poolAddress}`, error)
    }
  }

  /**
   * Creates a new CLMM pool with initial liquidity within the specified tick range.
   * Tokens and ticks are sorted internally to match on-chain ordering.
   */
  async createPool(
    configIndex: bigint,
    token0: string,
    token1: string,
    tick: bigint,
    amount0: bigint,
    amount1: bigint,
    tickLower: bigint,
    tickUpper: bigint,
    dustAmount?: bigint
  ): Promise<{ poolId: string; result: ExecuteScriptResult }> {
    const sqrtPriceX96 = TickUtils.getSqrtRatioAtTick(tick)
    const tokens = [token0, token1]
    const amounts = [amount0, amount1]
    const ticks = [tickLower, tickUpper]
    if (token0 > token1) {
      tokens.reverse()
      amounts.reverse()
    }
    if (tickLower > tickUpper) {
      ticks.reverse()
    }
    const sqrtPriceX96A = TickUtils.getSqrtRatioAtTick(ticks[0])
    const sqrtPriceX96B = TickUtils.getSqrtRatioAtTick(ticks[1])
    const liquidity = ClmmLiquidityUtils.getLiquidityFromAmounts(
      sqrtPriceX96,
      sqrtPriceX96A,
      sqrtPriceX96B,
      amounts[0],
      amounts[1]
    )
    const result = await CreateLiquidPool.execute({
      signer: this.scope.signer,
      initialFields: {
        factory: this.config.factoryId,
        token0: tokens[0],
        token1: tokens[1],
        liquidity,
        tickLower: ticks[0],
        tickUpper: ticks[1],
        sqrtPriceX96,
        configIndex,
        amount0: amounts[0],
        amount1: amounts[1]
      },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT * 6n,
      tokens: [
        { id: tokens[0], amount: amounts[0] },
        { id: tokens[1], amount: amounts[1] }
      ],
      dustAmount: dustAmount ?? MINIMAL_CONTRACT_DEPOSIT * 2n
    })
    const poolId = this.getPoolId(tokens[0], tokens[1], configIndex)
    return { poolId, result }
  }

  /** Adds liquidity to a tick range, minting a new position or updating an existing one. */
  async addLiquidity(p: ClmmAddLiquidityRequest): Promise<{ positionId: string; result: SignExecuteScriptTxResult }> {
    const [positionId, positionManager, params] = await this.getAddLiquidityParams(p)
    return await this.addLiquidityFromParams(positionId, positionManager, params)
  }

  /**
   * Prepares add-liquidity transaction parameters without executing.
   * Useful for previewing the transaction or splitting preparation from execution.
   */
  async getAddLiquidityParams(
    p: ClmmAddLiquidityRequest
  ): Promise<[string, PositionManagerInstance, PositionManagerTypes.SignExecuteMethodParams<'addLiquidity'>]> {
    const poolAddress = this.getPoolAddress(p.token0, p.token1, p.configIndex)
    const pool = Pool.at(poolAddress)
    const positionManagerAddress = addressFromContractId(this.config.positionManagerId)
    const positionManager = PositionManager.at(positionManagerAddress)

    const signerAccount = await this.scope.signer.getSelectedAccount()
    const owner = p.owner || signerAccount.address

    const group = this.config.groupIndex
    const normalizedOwner = normalizeAddress(owner, group)
    const normalizedPayer = normalizeAddress(signerAccount.address, group)

    const {
      returns: [sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, deposit]
    } = await positionManager.view.getSqrtPricesX96({
      args: {
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        pool: pool.contractId,
        owner: normalizedOwner
      }
    })
    const minSqrtPriceX96 = TickUtils.getSqrtPriceLimitX96(sqrtPriceX96, p.slippage, true)
    const maxSqrtPriceX96 = TickUtils.getSqrtPriceLimitX96(sqrtPriceX96, p.slippage, false)

    const minLiquidity = ClmmLiquidityUtils.getLiquidityFromAmounts(
      minSqrtPriceX96,
      sqrtRatioAX96,
      sqrtRatioBX96,
      p.amount0,
      p.amount1
    )
    const [, minAmount1] = ClmmLiquidityUtils.getAmountsForLiquidity(
      minSqrtPriceX96,
      sqrtRatioAX96,
      sqrtRatioBX96,
      -minLiquidity
    )
    const maxLiquidity = ClmmLiquidityUtils.getLiquidityFromAmounts(
      maxSqrtPriceX96,
      sqrtRatioAX96,
      sqrtRatioBX96,
      p.amount0,
      p.amount1
    )
    const [maxAmount0] = ClmmLiquidityUtils.getAmountsForLiquidity(
      maxSqrtPriceX96,
      sqrtRatioAX96,
      sqrtRatioBX96,
      -maxLiquidity
    )

    const positionId = PoolUtils.getPositionId(poolAddress, owner, p.tickLower, p.tickUpper)
    const attoAlphAmount = DUST_AMOUNT * 2n
    const tokens: Token[] = [
      { id: p.token0, amount: p.amount0 + (p.token0 === ALPH_TOKEN_ID ? attoAlphAmount : 0n) },
      { id: p.token1, amount: p.amount1 }
    ]

    if (p.existingPosition) {
      tokens.push({ id: positionId, amount: 1n })
    }

    const params = {
      signer: this.scope.signer,
      args: {
        payer: normalizedPayer,
        p: {
          token0: p.token0,
          token1: p.token1,
          configIndex: p.configIndex,
          owner: normalizedOwner,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          amount0Desired: p.amount0,
          amount1Desired: p.amount1,
          amount0Min: -maxAmount0,
          amount1Min: -minAmount1
        }
      },
      tokens,
      attoAlphAmount,
      dustAmount: deposit,
      positionId
    }
    return [positionId, positionManager, params]
  }

  /** Executes an add-liquidity transaction from pre-computed parameters. */
  async addLiquidityFromParams(
    positionId: string,
    positionManager: PositionManagerInstance,
    params: PositionManagerTypes.SignExecuteMethodParams<'addLiquidity'>
  ): Promise<{ positionId: string; result: SignExecuteScriptTxResult }> {
    const result = await positionManager.transact.addLiquidity(params)
    return { positionId, result }
  }

  /** Decreases liquidity from an existing position within the specified tick range. */
  async removeLiquidity(
    p: ClmmRemoveLiquidityRequest
  ): Promise<{ positionId: string; result: SignExecuteScriptTxResult }> {
    const poolAddress = this.getPoolAddress(p.token0, p.token1, p.configIndex)
    const positionManagerAddress = addressFromContractId(this.config.positionManagerId)
    const positionManager = PositionManager.at(positionManagerAddress)
    const signerAccount = await this.scope.signer.getSelectedAccount()

    const group = this.config.groupIndex
    const normalizedOwner = normalizeAddress(p.owner, group)
    const normalizedOperator = normalizeAddress(signerAccount.address, group)

    const positionId = PoolUtils.getPositionId(poolAddress, p.owner, p.tickLower, p.tickUpper)

    // Determine minimum amounts based on base token selection (Raydium pattern)
    // For remove liquidity: base amount is what we expect, other amount is the minimum we'll accept
    const amount0Min = p.base === 'token0' ? p.baseAmount : p.otherAmountMax
    const amount1Min = p.base === 'token0' ? p.otherAmountMax : p.baseAmount

    const result = await positionManager.transact.decreaseLiquidity({
      signer: this.scope.signer,
      args: {
        liquidity: p.liquidity,
        operator: normalizedOperator,
        p: {
          configIndex: p.configIndex,
          token0: p.token0,
          token1: p.token1,
          owner: normalizedOwner,
          recipient: normalizedOperator,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          amount0Min: amount0Min,
          amount1Min: amount1Min
        }
      },
      tokens: [{ id: positionId, amount: 1n }],
      attoAlphAmount: DUST_AMOUNT * 3n
    })
    return { positionId, result }
  }

  /** Queries on-chain position state including accrued fees and current liquidity. */
  async positionInfo({ poolId, ...args }: ClmmPositionInfoRequest): Promise<ClmmPositionInfo> {
    const pool = Pool.at(addressFromContractId(poolId))
    const { returns } = await pool.view.positionInfo({ args })
    return returns
  }
  /** Collects accrued fees from a position, optionally removing liquidity in the same transaction. */
  async collectTokens(p: ClmmCollectTokensRequest): Promise<{ positionId: string; result: SignExecuteScriptTxResult }> {
    const poolAddress = this.getPoolAddress(p.token0, p.token1, p.configIndex)
    const positionId = PoolUtils.getPositionId(poolAddress, p.owner, p.tickLower, p.tickUpper)
    const positionManagerAddress = addressFromContractId(this.config.positionManagerId)
    const signerAccount = await this.scope.signer.getSelectedAccount()

    const group = this.config.groupIndex
    const normalizedOwner = normalizeAddress(p.owner, group)
    const normalizedOperator = normalizeAddress(signerAccount.address, group)
    const normalizedRecipient = normalizeAddress(p.recipient, group)

    const positionManager = PositionManager.at(positionManagerAddress)
    const result = await positionManager.transact.collect({
      signer: this.scope.signer,
      args: {
        liquidity: p.liquidity,
        operator: normalizedOperator,
        p: {
          configIndex: p.configIndex,
          token0: p.token0,
          token1: p.token1,
          owner: normalizedOwner,
          recipient: normalizedRecipient,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          amount0Max: p.amount0Max,
          amount1Max: p.amount1Max
        }
      },
      tokens: [{ id: positionId, amount: 1n }],
      attoAlphAmount: DUST_AMOUNT * 3n
    })

    return { positionId, result }
  }

  /**
   * Finds the fee tier (config index) with the most liquidity for a token pair.
   * @throws {PoolNotFoundError} If no pool exists for the token pair across any fee tier.
   */
  async findBestRoute(token0: string, token1: string): Promise<bigint> {
    const poolFactoryAddress = addressFromContractId(this.config.factoryId)
    const poolFactory = PoolFactory.at(poolFactoryAddress)
    const state = await poolFactory.fetchState()
    const f = (_: number, i: number) => this.getPoolAddress(token0, token1, BigInt(i))
    const addresses = Array.from({ length: Number(state.fields.nextConfigIndex) }, f)
    const pools = await Promise.all(
      addresses.map(async (addr, i) =>
        (await this.poolExists(token0, token1, BigInt(i))) ? Pool.at(addr).fetchState() : undefined
      )
    )
    const [index] = pools.reduce<[bigint, bigint]>(
      ([index, liquidity], pool, i) => {
        const liquidity2 = pool?.fields.liquidity || 0n
        return liquidity2 > liquidity ? [BigInt(i), liquidity2] : [index, liquidity]
      },
      [-1n, 0n]
    )

    if (index === -1n) {
      throw new PoolNotFoundError(`No concentrated liquidity pool found for token pair ${token0}/${token1}`)
    }

    return index
  }

  /** Simulates a swap off-chain and returns the resulting price, liquidity distribution, and fee. */
  async simulateSwap(p: ClmmSimulateSwapParams): Promise<ClmmSimulateSwapQuote> {
    const poolAddress = this.getPoolAddress(p.token0, p.token1, p.configIndex)
    const pool = Pool.at(poolAddress)
    const result = await pool.view.simulateSwap({
      args: {
        amountSpecified: p.amount,
        zeroForOne: p.zeroForOne,
        data: p.data ?? '',
        maxSteps: 500n
      },
      interestedContracts: p.interestedContracts
    })

    const poolState = result.contracts.at(0)?.fields as PoolTypes.Fields
    const startEvent = result.events.at(0) as PoolTypes.SwapStartEvent
    return {
      sqrtPriceX96: poolState.slot0.sqrtPriceX96,
      baseSqrtPriceX96: startEvent.fields.sqrtPriceX96,
      liquidity: poolState.liquidity,
      fee: poolState.fee,
      rows: result.events.slice(1).map((e) => {
        const event = e as PoolTypes.SwapStepEvent
        return {
          sqrtPriceX96: event.fields.sqrtPriceX96,
          liquidity: event.fields.liquidity
        }
      })
    }
  }

  /** Executes a swap transaction using the first entry in the route plan. */
  async swap(p: ClmmSwapRequest): Promise<SignExecuteScriptTxResult> {
    const configIndex = p.routePlan[0]
    const pool = this.getPool(p.token0, p.token1, configIndex)
    const poolState = await pool.fetchState()
    const sqrtPriceX96 = poolState.fields.slot0.sqrtPriceX96
    const zeroForOne = poolState.fields.token0 === p.token0
    const sqrtPriceLimitX96 = TickUtils.getSqrtPriceLimitX96(sqrtPriceX96, p.slippage, zeroForOne)

    const tokens = sortTokens(p.token0, p.token1)
    const [tokenIn, tokenOut] = zeroForOne ? tokens : tokens.reverse()

    const group = this.config.groupIndex
    const sender = (await this.scope.signer.getSelectedAccount()).address
    const feeRecipient = p.feeRecipient === undefined ? undefined : normalizeAddress(p.feeRecipient, group)
    const feeAmount = validateIntegratorFee({
      fee: p.fee,
      feeRecipient,
      sender: normalizeAddress(sender, group),
      tokenInId: tokenIn
    })

    const attoAlphAmount = DUST_AMOUNT * 2n + (feeAmount > 0n && tokenIn !== ALPH_TOKEN_ID ? DUST_AMOUNT : 0n)
    const amount = p.amountIn + feeAmount + (tokenIn == ALPH_TOKEN_ID ? attoAlphAmount : 0n)

    const initialFields = {
      pool: pool.contractId,
      tokenIn,
      tokenOut,
      zeroForOne,
      amountSpecified: p.amount,
      sqrtPriceLimitX96,
      data: ''
    }

    if (feeAmount > 0n) {
      return await SwapWithoutAccountWithFee.execute({
        signer: this.scope.signer,
        initialFields: { ...initialFields, feeRecipient: feeRecipient!, feeAmount },
        tokens: [{ id: tokenIn, amount }],
        attoAlphAmount
      })
    } else {
      return await SwapWithoutAccount.execute({
        signer: this.scope.signer,
        initialFields,
        tokens: [{ id: tokenIn, amount }],
        attoAlphAmount
      })
    }
  }

  async swapTo(p: ClmmSwapToRequest): Promise<SignExecuteScriptTxResult> {
    const pool = this.getPool(p.tokenIn, p.tokenOut, p.configIndex)
    const poolState = await pool.fetchState()
    const zeroForOne = poolState.fields.token0 === p.tokenIn
    const signerAccount = await this.scope.signer.getSelectedAccount()
    const signerAddress = signerAccount.address

    const MAX_AMOUNT = (1n << 127n) - 1n // close to I256 max

    return await pool.transact.swap({
      signer: this.scope.signer,
      args: {
        payer: signerAddress,
        recipient: signerAddress,
        token: p.tokenOut,
        zeroForOne,
        amountSpecified: MAX_AMOUNT,
        sqrtPriceLimitX96: p.targetSqrtPriceX96,
        data: ''
      },
      tokens: [{ id: p.tokenIn, amount: p.amountInMax }],
      attoAlphAmount: DUST_AMOUNT * 2n
    })
  }

  async setRewardParams(p: ClmmSetRewardParamsRequest): Promise<SignExecuteScriptTxResult> {
    const poolFactoryAddress = addressFromContractId(this.config.factoryId)
    const poolFactory = PoolFactory.at(poolFactoryAddress)
    const index = p.rewardToken === p.token0 ? 0n : p.rewardToken === p.token1 ? 1n : 2n
    const result = await poolFactory.transact.setRewardParams({
      signer: this.scope.signer,
      args: {
        token0: p.token0,
        token1: p.token1,
        configIndex: p.configIndex,
        amount: p.amount,
        index,
        openTime: p.openTime,
        endTime: p.endTime,
        payer: p.payer,
        tokenId: p.rewardToken
      },
      tokens: [{ id: p.rewardToken, amount: p.amount }],
      attoAlphAmount: DUST_AMOUNT
    })
    return result
  }

  /** Extends an existing farming reward program by adding more tokens. Admin only. */
  async extendRewards(p: ClmmExtendRewardsRequest): Promise<SignExecuteScriptTxResult> {
    const poolAddress = this.getPoolAddress(p.token0, p.token1, p.configIndex)
    const pool = Pool.at(poolAddress)
    const index = p.rewardToken === p.token0 ? 0n : p.rewardToken === p.token1 ? 1n : 2n
    const result = await pool.transact.extendRewards({
      signer: this.scope.signer,
      args: {
        payer: p.payer,
        index,
        amount: p.amount
      },
      tokens: [{ id: p.rewardToken, amount: p.amount }],
      attoAlphAmount: DUST_AMOUNT
    })
    return result
  }

  getCollectProtocolFeesData(token0: string, token1: string, configIndex: bigint, tokenId: string): string {
    const [t0, t1] = sortTokens(token0, token1)
    const poolPath = t0 + t1 + this.getPoolConfigId(configIndex)
    return tokenId + poolPath
  }

  async collectProtocolFees(p: ClmmCollectProtocolFeesRequest): Promise<SignExecuteScriptTxResult> {
    return await this.scope.staking.collectProtocolFeesCLMM(
      this.config.factoryId,
      p.token0,
      p.token1,
      p.configIndex,
      p.tokenId
    )
  }

  async setFeeCollector(): Promise<SignExecuteScriptTxResult> {
    const factory = PoolFactory.at(addressFromContractId(this.config.factoryId))
    const newFeeCollector = addressFromContractId(this.scope.staking.getConfig().feeCollectorId)
    return factory.transact.setFeeCollector({
      signer: this.scope.signer,
      args: { newFeeCollector }
    })
  }

  async migrateFactory(newBytecode: string): Promise<SignExecuteScriptTxResult> {
    const factory = PoolFactory.at(addressFromContractId(this.config.factoryId))
    const factoryState = await factory.fetchState()
    const { encodedImmFields, encodedMutFields } = PoolFactory.encodeFields(factoryState.fields)
    return await factory.transact.upgrade({
      signer: this.scope.signer,
      args: { newBytecode, immFields: binToHex(encodedImmFields), mutFields: binToHex(encodedMutFields) }
    })
  }

  async changeUpgrader(newUpgrader: string): Promise<SignExecuteScriptTxResult> {
    const factory = PoolFactory.at(addressFromContractId(this.config.factoryId))
    return await factory.transact.changeUpgrader({
      signer: this.scope.signer,
      args: { newUpgrader }
    })
  }

  async finalizeFactory(): Promise<SignExecuteScriptTxResult> {
    return await this.changeUpgrader('111111111111111111111111111111111')
  }

  async transferOwnership(newOwner: string): Promise<SignExecuteScriptTxResult> {
    const factoryId = this.config.factoryId
    const factory = PoolFactory.at(addressFromContractId(factoryId))
    return await factory.transact.transferOwnership({
      signer: this.scope.signer,
      args: { newOwner }
    })
  }

  async migrateDexAccount(
    newBytecode: string,
    immFields: string,
    mutFields: string
  ): Promise<SignExecuteScriptTxResult> {
    const dexRoot = DexAccountRoot.at(addressFromContractId(this.config.accountRoot))
    return await dexRoot.transact.upgrade({
      signer: this.scope.signer,
      args: { newCode: newBytecode, immFields, mutFields }
    })
  }

  async upgradeUserDexAccount(
    owner: string,
    newBytecode: string,
    immFields: string,
    mutFields: string
  ): Promise<SignExecuteScriptTxResult> {
    const dexRoot = DexAccountRoot.at(addressFromContractId(this.config.accountRoot))
    const accountId = this.getDexAccountId(owner)
    return await dexRoot.transact.upgradeDexAccount({
      signer: this.scope.signer,
      args: {
        newCode: newBytecode,
        dexAccount: accountId,
        immFields,
        mutFields
      }
    })
  }

  getDexAccountRoot(): DexAccountRootInstance {
    return DexAccountRoot.at(addressFromContractId(this.config.accountRoot))
  }

  getDexAccountId(owner: string): string {
    const group = this.config.groupIndex
    const path = binToHex(addressToBytes(owner))
    const accountRoot = this.config.accountRoot
    return subContractId(accountRoot, path, group)
  }

  async getDexAccountState(owner: string) {
    const accountId = this.getDexAccountId(owner)
    const account = DexAccount.at(addressFromContractId(accountId))
    return {
      address: account.address,
      id: account.contractId,
      state: await account.fetchState()
    }
  }

  async createDexAccount(referrer: string): Promise<ExecuteScriptResult> {
    const root = DexAccountRoot.at(addressFromContractId(this.config.accountRoot))
    return await root.transact.createAccount({
      signer: this.scope.signer,
      args: { ref: referrer },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
    })
  }

  async setClmmParent(clmmParent: string): Promise<ExecuteScriptResult> {
    const root = DexAccountRoot.at(addressFromContractId(this.config.accountRoot))
    return await root.transact.setClmmParent({
      signer: this.scope.signer,
      args: { clmmParent }
    })
  }

  async setCpmmParent(cpmmParent: string): Promise<ExecuteScriptResult> {
    const root = DexAccountRoot.at(addressFromContractId(this.config.accountRoot))
    return await root.transact.setCpmmParent({
      signer: this.scope.signer,
      args: { cpmmParent }
    })
  }

  buildSwapPath(tokenId: string, configIndex: bigint): string {
    return tokenId + configIndex.toString(16).padStart(4, '0')
  }

  getConfig(): ClmmConfig {
    const networkId = this.scope.network.id
    try {
      const deployments = loadDeployments(networkId)
      return {
        groupIndex: deployments.contracts.PoolFactory.contractInstance.groupIndex,
        factoryId: deployments.contracts.PoolFactory.contractInstance.contractId,
        positionManagerId: deployments.contracts.PositionManager.contractInstance.contractId,
        defaultConfigIndex: 0n,
        accountRoot: deployments.contracts.DexAccountRoot.contractInstance.contractId
      }
    } catch (error) {
      this.logAndThrowError(`Failed to load deployments on ${networkId}`, error)
    }
  }
}
