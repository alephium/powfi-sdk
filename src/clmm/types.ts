import type { TokenInfo } from '@alephium/token-list';

export interface ClmmConfig {
  groupIndex: number;
  factoryId: string;
  positionManagerId: string;
  defaultConfigIndex: bigint;
}

export interface ClmmSwapParams {
  configIndex: bigint;
  token0: string;
  token1: string;
  zeroForOne: boolean;
  amount: bigint;
  slippage: bigint;
}

export interface SimulateSwap {
  configIndex: bigint;
  token0: string;
  token1: string;
  zeroForOne: boolean;
  amount: bigint;
}

export interface LiquidityForPrice {
  liquidity: bigint;
  sqrtPriceX96: bigint;
}

export interface LiquidityDistribution {
  baseSqrtPriceX96: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  fee: bigint;
  rows: Array<LiquidityForPrice>;
}

export interface AddLiquidity {
  token0: string;
  token1: string;
  configIndex: bigint;
  owner?: string;
  tickLower: bigint;
  tickUpper: bigint;
  slippage: bigint;
  amount0: bigint;
  amount1: bigint;
}

export interface RemoveLiquidity {
  token0: string;
  token1: string;
  configIndex: bigint;
  owner: string;
  tickLower: bigint;
  tickUpper: bigint;
  liquidity: bigint;
  base: 'token0' | 'token1';
  baseAmount: bigint;
  otherAmountMax: bigint;
}

export interface CollectTokens {
  token0: string;
  token1: string;
  configIndex: bigint;
  owner: string;
  recipient: string;
  tickLower: bigint;
  tickUpper: bigint;
  liquidity: bigint; // != 0 if also remove liquidity
  amount0Max: bigint;
  amount1Max: bigint;
}

export interface CollectProtocolFees {
  token0: string;
  token1: string;
  configIndex: bigint;
  recipient: string;
}

export interface ClmmPoolState {
  poolId: string;
  token0Info: TokenInfo;
  token1Info: TokenInfo;
  liquidity: bigint;
  tradingFee: bigint;
  protocolFee: bigint;
  sqrtPriceX96: bigint;
  tick: bigint;
  tickSpacing: bigint;
}
