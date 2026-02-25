import type { ExecuteScriptResult } from '@alephium/web3';
import {
  DUST_AMOUNT,
  addressFromContractId,
  subContractId,
  ALPH_TOKEN_ID,
  ONE_ALPH,
  prettifyTokenAmount,
} from '@alephium/web3';
import {
  TokenPair as TokenPairContract,
  SwapMaxIn,
  SwapMinOut,
  AddLiquidity,
  RemoveLiquidity,
  CreatePair,
  CreatePairAndAddLiquidity,
} from 'cpmm/artifacts/ts';
import { loadDeployments } from 'cpmm/artifacts/ts/deployments';
import type { TokenInfo } from '@alephium/token-list';
import { sortTokens } from '../common/utils';
import { MAX_PRICE_IMPACT } from './constants';
import {
  InsufficientBalanceError,
  PriceImpactTooHighError,
  PoolNotFoundError,
} from '../common/error';
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
} from './types';
import type { Powfi } from '../powfi';
import ModuleBase from '../moduleBase';
import BigNumber from 'bignumber.js';
import { MathUtil } from '../common/math';
import { MINIMUM_LIQUIDITY } from './constants';
import { BPS } from '../common/constants';
import { InsufficientLiquidityError } from '../common/error';

export class CpmmModule extends ModuleBase {
  private config: CpmmConfig;

  constructor(scope: Powfi) {
    super({ scope, moduleName: 'CpmmModule' });

    this.config = this.getCpmmConfig();
    this.scope = scope;
  }

  getPoolId(tokenA: string, tokenB: string): string {
    const [token0Id, token1Id] = sortTokens(tokenA, tokenB);
    const path = token0Id + token1Id;
    return subContractId(this.config.factoryId, path, this.config.groupIndex);
  }

  getPoolAddress(tokenA: string, tokenB: string): string {
    return addressFromContractId(this.getPoolId(tokenA, tokenB));
  }

  async getPoolState(tokenA: string, tokenB: string): Promise<CpmmPoolContractState> {
    const [token0Id, token1Id] = sortTokens(tokenA, tokenB);
    const token0Info = await this.scope.token.getTokenById(token0Id);
    const token1Info = await this.scope.token.getTokenById(token1Id);

    const poolId = this.getPoolId(tokenA, tokenB);
    const contractAddress = addressFromContractId(poolId);
    const pool = TokenPairContract.at(contractAddress);

    try {
      const state = await pool.fetchState();
      return {
        poolId,
        reserve0: state.fields.reserve0,
        reserve1: state.fields.reserve1,
        token0Info,
        token1Info,
        totalSupply: state.fields.totalSupply,
        dexAccount: state.fields.dexAccount0,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new PoolNotFoundError(poolId);
      }
      this.logAndThrowError(`Failed to fetch pool state on ${poolId}`, error);
    }
  }

  async poolExists(tokenA: string, tokenB: string): Promise<boolean> {
    const address = this.getPoolAddress(tokenA, tokenB);

    return this.scope.nodeProvider.addresses
      .getAddressesAddressGroup(address)
      .then((_) => true)
      .catch((e: any) => {
        if (e instanceof Error && e.message.indexOf('Group not found') !== -1) {
          return false;
        }
        throw e;
      });
  }

  async swap(
    params: CpmmSwapRequest,
    balances?: Map<string, bigint>,
  ): Promise<ExecuteScriptResult> {
    if (!this.scope.signer) {
      throw new Error('Signer is required for swap operation');
    }

    const poolState = await this.getPoolState(params.tokenInId, params.tokenOutId);
    const swapDetails = CpmmModule.computeSwapAmount({
      state: poolState,
      tokenInId: params.tokenInId,
      tokenOutId: params.tokenOutId,
      amountIn: params.amountIn,
      amountOut: params.amountOut,
      slippageBps: params.slippageBps,
    });

    if (swapDetails.priceImpact >= MAX_PRICE_IMPACT) {
      throw new PriceImpactTooHighError(swapDetails.priceImpact, MAX_PRICE_IMPACT);
    }

    if (balances) {
      const available = balances.get(swapDetails.tokenInInfo.id) ?? 0n;
      if (available < swapDetails.tokenInAmount) {
        throw new InsufficientBalanceError(
          swapDetails.tokenInInfo.symbol,
          prettifyTokenAmount(swapDetails.tokenInAmount, swapDetails.tokenInInfo.decimals) ??
            `${swapDetails.tokenInAmount}`,
          prettifyTokenAmount(available, swapDetails.tokenInInfo.decimals) ?? `${available}`,
        );
      }
    }

    const ttlMinutes = params.ttlMinutes ?? 60;

    if (swapDetails.swapType === 'ExactIn') {
      let attoAlphAmount = this.getExtraAlphAmount(
        swapDetails.state.token0Info.id,
        swapDetails.state.token1Info.id,
      );
      const tokens: Array<{ id: string; amount: bigint }> = [];

      if (swapDetails.tokenInInfo.id === ALPH_TOKEN_ID) {
        attoAlphAmount += swapDetails.tokenInAmount;
      } else {
        tokens.push({ id: swapDetails.tokenInInfo.id, amount: swapDetails.tokenInAmount });
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
          deadline: deadline(ttlMinutes),
        },
        attoAlphAmount,
        tokens,
      });
      return result;
    } else {
      let attoAlphAmount = this.getExtraAlphAmount(
        swapDetails.state.token0Info.id,
        swapDetails.state.token1Info.id,
      );
      const tokens: Array<{ id: string; amount: bigint }> = [];

      if (swapDetails.tokenInInfo.id === ALPH_TOKEN_ID) {
        attoAlphAmount += swapDetails.maximalTokenInAmount!;
      } else {
        tokens.push({ id: swapDetails.tokenInInfo.id, amount: swapDetails.maximalTokenInAmount! });
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
          deadline: deadline(ttlMinutes),
        },
        attoAlphAmount,
        tokens,
      });
      return result;
    }
  }

  async addLiquidity(
    params: CpmmAddLiquidityRequest,
    balances?: Map<string, bigint>,
  ): Promise<ExecuteScriptResult> {
    if (!this.scope.signer) {
      throw new Error('Signer is required for addLiquidity operation');
    }

    const {
      poolState,
      tokenAId,
      tokenBId,
      amountA,
      amountB,
      slippageBps,
      sender,
      ttlMinutes = 60,
    } = params;
    const tokenAInfo = CpmmModule.getTokenInfoFromPoolState(poolState, tokenAId, 'tokenAId');
    const tokenBInfo = CpmmModule.getTokenInfoFromPoolState(poolState, tokenBId, 'tokenBId');

    if (amountA === 0n || amountB === 0n) {
      throw new Error('The input amount must be greater than 0');
    }

    if (balances) {
      const tokenAAvailable = balances.get(tokenAInfo.id) ?? 0n;
      if (tokenAAvailable < amountA) {
        throw new InsufficientBalanceError(
          tokenAInfo.symbol,
          prettifyTokenAmount(amountA, tokenAInfo.decimals) ?? `${amountA}`,
          prettifyTokenAmount(tokenAAvailable, tokenAInfo.decimals) ?? `${tokenAAvailable}`,
        );
      }

      const tokenBAvailable = balances.get(tokenBInfo.id) ?? 0n;
      if (tokenBAvailable < amountB) {
        throw new InsufficientBalanceError(
          tokenBInfo.symbol,
          prettifyTokenAmount(amountB, tokenBInfo.decimals) ?? `${amountB}`,
          prettifyTokenAmount(tokenBAvailable, tokenBInfo.decimals) ?? `${tokenBAvailable}`,
        );
      }
    }

    const isInitial = poolState.reserve0 === 0n && poolState.reserve1 === 0n;
    const amountAMin = isInitial ? amountA : CpmmModule.minimalAmount(amountA, slippageBps);
    const amountBMin = isInitial ? amountB : CpmmModule.minimalAmount(amountB, slippageBps);

    const [amount0Desired, amount1Desired, amount0Min, amount1Min] =
      tokenAId === poolState.token0Info.id
        ? [amountA, amountB, amountAMin, amountBMin]
        : [amountB, amountA, amountBMin, amountAMin];

    // Calculate ALPH amounts properly
    const extraAlph = this.getExtraAlphAmount(tokenAId, tokenBId);
    let attoAlphAmount = extraAlph + DUST_AMOUNT;
    const tokens: Array<{ id: string; amount: bigint }> = [];

    // Handle ALPH token properly - don't double count it
    if (tokenAId === ALPH_TOKEN_ID) {
      attoAlphAmount += amountA;
      tokens.push({ id: tokenBId, amount: amountB });
    } else if (tokenBId === ALPH_TOKEN_ID) {
      attoAlphAmount += amountB;
      tokens.push({ id: tokenAId, amount: amountA });
    } else {
      tokens.push({ id: tokenAId, amount: amountA }, { id: tokenBId, amount: amountB });
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
        deadline: deadline(ttlMinutes),
      },
      attoAlphAmount,
      tokens,
    });
    return result;
  }

  async removeLiquidity(params: CpmmRemoveLiquidityRequest): Promise<ExecuteScriptResult> {
    if (!this.scope.signer) {
      throw new Error('Signer is required for removeLiquidity operation');
    }

    const {
      poolState,
      liquidity,
      totalLiquidityAmount,
      slippageBps,
      sender,
      ttlMinutes = 60,
    } = params;
    const ownedLiquidity = totalLiquidityAmount ?? poolState.totalSupply;
    const details = CpmmModule.computeRemoveLiquidityAmounts(poolState, ownedLiquidity, liquidity);

    const amount0Min = CpmmModule.minimalAmount(details.amount0, slippageBps);
    const amount1Min = CpmmModule.minimalAmount(details.amount1, slippageBps);

    const result = await RemoveLiquidity.execute({
      signer: this.scope.signer,
      initialFields: {
        sender,
        router: this.config.routerId,
        pairId: poolState.poolId,
        liquidity,
        amount0Min,
        amount1Min,
        deadline: deadline(ttlMinutes),
      },
      attoAlphAmount:
        this.getExtraAlphAmount(poolState.token0Info.id, poolState.token1Info.id) + DUST_AMOUNT,
      tokens: [{ id: poolState.poolId, amount: liquidity }],
    });
    return result;
  }

  async computeClaimableAmounts(
    tokenAId: string,
    tokenBId: string,
    liquidityBalance: bigint,
  ): Promise<CpmmClaimableAmounts> {
    const state = await this.getPoolState(tokenAId, tokenBId);
    const details = CpmmModule.computeClaimableAmounts(state, liquidityBalance);
    return {
      token0: details.token0,
      amount0: details.amount0,
      token1: details.token1,
      amount1: details.amount1,
    };
  }

  async createPool(
    params: CpmmCreatePoolRequest,
  ): Promise<ExecuteScriptResult & { poolId: string }> {
    if (!this.scope.signer) {
      throw new Error('Signer is required for createPool operation');
    }

    const { tokenAId, tokenBId, sender, initialLiquidity } = params;
    const poolId = this.getPoolId(tokenAId, tokenBId);

    if (initialLiquidity) {
      const { tokenAAmount, tokenBAmount } = initialLiquidity;
      const [token0Id, token1Id] = sortTokens(tokenAId, tokenBId);
      const [amount0, amount1] =
        token0Id === tokenAId ? [tokenAAmount, tokenBAmount] : [tokenBAmount, tokenAAmount];
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
        },
        attoAlphAmount: ONE_ALPH + this.getExtraAlphAmount(tokenAId, tokenBId),
        tokens: [
          { id: token0Id, amount: amount0 },
          { id: token1Id, amount: amount1 },
        ],
      });
      return { ...result, poolId };
    }

    const result = await CreatePair.execute({
      signer: this.scope.signer,
      initialFields: {
        payer: sender,
        factory: this.config.factoryId,
        alphAmount: ONE_ALPH,
        tokenAId,
        tokenBId,
      },
      attoAlphAmount: ONE_ALPH + this.getExtraAlphAmount(tokenAId, tokenBId),
      tokens: [
        { id: tokenAId, amount: 1n },
        { id: tokenBId, amount: 1n },
      ],
    });
    return { ...result, poolId };
  }

  getCpmmConfig(): CpmmConfig {
    const networkId = this.scope.network.id;
    try {
      const deployments = loadDeployments(networkId);
      return {
        groupIndex: deployments.contracts.Router.contractInstance.groupIndex,
        factoryId: deployments.contracts.TokenPairFactory.contractInstance.contractId,
        routerId: deployments.contracts.Router.contractInstance.contractId,
      };
    } catch (error) {
      this.logAndThrowError(`Failed to load deployments on ${networkId}`, error);
    }
  }

  static computeSwapAmount(params: CpmmSwapQuoteParams): CpmmSwapQuote {
    const { state, tokenInId, tokenOutId, amountIn, amountOut, slippageBps } = params;
    const tokenInInfo = this.getTokenInfoFromPoolState(state, tokenInId, 'tokenInId');
    const tokenOutInfo = this.getTokenInfoFromPoolState(state, tokenOutId, 'tokenOutId');

    let swapType: 'ExactIn' | 'ExactOut';
    let tokenInAmount: bigint;
    let tokenOutAmount: bigint;

    if (amountIn !== undefined) {
      swapType = 'ExactIn';
      tokenInAmount = amountIn;
      tokenOutAmount = CpmmModule.getAmountOut(state, tokenInInfo.id, amountIn);
    } else if (amountOut !== undefined) {
      swapType = 'ExactOut';
      tokenInAmount = CpmmModule.getAmountIn(state, tokenOutInfo.id, amountOut);
      tokenOutAmount = amountOut;
    } else {
      throw new Error('Either amountIn or amountOut must be specified');
    }

    const priceImpact = this.calcPriceImpact(
      state.reserve0,
      state.reserve1,
      tokenInInfo.id,
      state.token0Info.id,
      tokenInAmount,
      tokenOutAmount,
    );

    return {
      swapType,
      state,
      tokenInInfo,
      tokenOutInfo,
      tokenInAmount,
      tokenOutAmount,
      priceImpact,
      minimalTokenOutAmount:
        swapType === 'ExactIn' ? this.minimalAmount(tokenOutAmount, slippageBps) : undefined,
      maximalTokenInAmount:
        swapType === 'ExactOut' ? this.maximalAmount(tokenInAmount, slippageBps) : undefined,
    };
  }

  static computeLiquidityAmounts(
    params: CpmmAddLiquidityQuoteParams,
  ): CpmmAddLiquidityQuote {
    const { poolState, tokenAId, tokenBId, amountA, amountB, inputType = 'TokenA' } = params;

    if (!poolState) {
      // Initial liquidity
      if (amountA === undefined || amountB === undefined) {
        throw new Error('Both amountA and amountB are required for initial liquidity');
      }
      return this.getInitLiquidityDetails(tokenAId, tokenBId, amountA, amountB);
    }

    // Adding to existing pool
    const inputTokenId = inputType === 'TokenA' ? tokenAId : tokenBId;
    const inputAmount = inputType === 'TokenA' ? amountA : amountB;

    if (inputAmount === undefined) {
      throw new Error(`Amount for ${inputType} is required`);
    }

    return this.getLiquidityDetails(poolState, inputTokenId, inputAmount, inputType);
  }

  static computeRemoveLiquidityAmounts(
    state: CpmmPoolContractState,
    totalLiquidity: bigint,
    liquidityToRemove: bigint,
  ): CpmmRemoveLiquidityQuote {
    if (liquidityToRemove > totalLiquidity) {
      throw new Error('Liquidity exceeds total liquidity amount');
    }

    const amount0 = (liquidityToRemove * state.reserve0) / state.totalSupply;
    const amount1 = (liquidityToRemove * state.reserve1) / state.totalSupply;
    const remainShareAmount = totalLiquidity - liquidityToRemove;
    const remainPoolLiquidity = state.totalSupply - liquidityToRemove;
    const remainSharePercentage = BigNumber((100n * remainShareAmount).toString())
      .div(BigNumber(remainPoolLiquidity.toString()))
      .toFixed(5);

    return {
      state: state,
      token0: state.token0Info,
      amount0,
      token1: state.token1Info,
      amount1,
      remainShareAmount,
      remainSharePercentage: parseFloat(remainSharePercentage),
    };
  }

  static computeClaimableAmounts(
    state: CpmmPoolContractState,
    liquidityBalance: bigint,
  ): CpmmRemoveLiquidityQuote {
    return this.computeRemoveLiquidityAmounts(state, liquidityBalance, liquidityBalance);
  }

  static minimalAmount(amount: bigint, slippage: bigint): bigint {
    this.assertSlippageInRange(slippage);
    return (amount * BPS) / (BPS + slippage);
  }

  static maximalAmount(amount: bigint, slippage: bigint): bigint {
    this.assertSlippageInRange(slippage);
    return (amount * (BPS + slippage) + (BPS - 1n)) / BPS;
  }

  private static assertSlippageInRange(slippage: bigint): void {
    if (slippage < 0n || slippage >= BPS) {
      throw new Error(`Slippage must satisfy 0 <= slippage < ${BPS}, received ${slippage}`);
    }
  }

  static calcPriceImpact(
    reserve0: bigint,
    reserve1: bigint,
    tokenInId: string,
    token0Id: string,
    amountIn: bigint,
    amountOut: bigint,
  ): number {
    const [reserveIn, reserveOut] =
      token0Id === tokenInId ? [reserve0, reserve1] : [reserve1, reserve0];
    const numerator =
      (reserveOut * (reserveIn + amountIn) - (reserveOut - amountOut) * reserveIn) * 100n;
    const denumerator = reserveIn * (reserveOut - amountOut);
    const impact = new BigNumber(numerator.toString())
      .div(new BigNumber(denumerator.toString()))
      .toFixed();
    return parseFloat(impact);
  }

  static getLiquidityDetails(
    state: CpmmPoolContractState,
    inputTokenId: string,
    inputAmount: bigint,
    inputType: 'TokenA' | 'TokenB', // First or second token in the token input box
  ): CpmmAddLiquidityQuote {
    const isInputToken0 = inputTokenId === state.token0Info.id;
    const [reserveA, reserveB] = isInputToken0
      ? [state.reserve0, state.reserve1]
      : [state.reserve1, state.reserve0];

    const outputAmount = (inputAmount * reserveB) / reserveA;
    const liquidityA = (inputAmount * state.totalSupply) / reserveA;
    const liquidityB = (outputAmount * state.totalSupply) / reserveB;
    const liquidity = liquidityA < liquidityB ? liquidityA : liquidityB;
    const totalSupply = state.totalSupply + liquidity;
    const percentage = BigNumber((100n * liquidity).toString())
      .div(BigNumber(totalSupply.toString()))
      .toFixed(5);
    const sharePercentage = parseFloat(percentage);
    const outputTokenId = isInputToken0 ? state.token1Info.id : state.token0Info.id;

    const [tokenAId, tokenBId] =
      inputType === 'TokenA' ? [inputTokenId, outputTokenId] : [outputTokenId, inputTokenId];
    const [amountA, amountB] =
      inputType === 'TokenA' ? [inputAmount, outputAmount] : [outputAmount, inputAmount];
    return { state, tokenAId, tokenBId, amountA, amountB, shareAmount: liquidity, sharePercentage };
  }

  static getAmountIn(state: CpmmPoolContractState, tokenOutId: string, amountOut: bigint): bigint {
    const [tokenOutInfo, reserveIn, reserveOut] =
      tokenOutId === state.token0Info.id
        ? [state.token0Info, state.reserve1, state.reserve0]
        : [state.token1Info, state.reserve0, state.reserve1];

    if (amountOut >= reserveOut) {
      throw new InsufficientLiquidityError(
        `Amount must be less than reserve, amount: ${prettifyTokenAmount(amountOut, tokenOutInfo.decimals)}, reserve: ${prettifyTokenAmount(reserveOut, tokenOutInfo.decimals)}`,
      );
    }
    const numerator = reserveIn * amountOut * 1000n;
    const denominator = (reserveOut - amountOut) * 997n;
    return numerator / denominator + 1n;
  }

  static getAmountOut(state: CpmmPoolContractState, tokenInId: string, amountIn: bigint): bigint {
    if (tokenInId === state.token0Info.id) {
      return this._getAmountOut(amountIn, state.reserve0, state.reserve1);
    } else {
      return this._getAmountOut(amountIn, state.reserve1, state.reserve0);
    }
  }

  static getInitLiquidityDetails(
    tokenAId: string,
    tokenBId: string,
    amountA: bigint,
    amountB: bigint,
  ): CpmmAddLiquidityQuote {
    const liquidity = MathUtil.sqrt(amountA * amountB);
    if (liquidity <= MINIMUM_LIQUIDITY) {
      throw new InsufficientLiquidityError('Insufficient initial liquidity');
    }
    return {
      tokenAId,
      tokenBId,
      amountA,
      amountB,
      shareAmount: liquidity - MINIMUM_LIQUIDITY,
      sharePercentage: 100,
    };
  }

  private static getTokenInfoFromPoolState(
    state: CpmmPoolContractState,
    tokenId: string,
    tokenLabel: string,
  ): TokenInfo {
    if (state.token0Info.id === tokenId) {
      return state.token0Info;
    }
    if (state.token1Info.id === tokenId) {
      return state.token1Info;
    }
    throw new Error(`Unknown ${tokenLabel} ${tokenId} for pool ${state.poolId}`);
  }

  private static _getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
    const amountInExcludeFee = 997n * amountIn;
    const numerator = amountInExcludeFee * reserveOut;
    const denominator = amountInExcludeFee + 1000n * reserveIn;
    return numerator / denominator;
  }

  // TODO: This might not be needed
  private getExtraAlphAmount(tokenAId: string, tokenBId: string): bigint {
    if (tokenAId === ALPH_TOKEN_ID || tokenBId === ALPH_TOKEN_ID) {
      return DUST_AMOUNT * 2n;
    }
    return DUST_AMOUNT * 3n;
  }
}

function deadline(ttlInMinutes: number): bigint {
  return BigInt(Date.now() + ttlInMinutes * 60 * 1000);
}
