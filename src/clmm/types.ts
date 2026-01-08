import type { TokenInfo } from '@alephium/token-list';
import { Pool } from '../../clmm/artifacts/ts/Pool';
import { PositionInfo } from '../../clmm/artifacts/ts/types';

export interface ClmmConfig {
  groupIndex: number;
  factoryId: string;
  positionManagerId: string;
  defaultConfigIndex: bigint;
  accountRoot: string;
}

export interface ClmmSwapParams {
  token0: string;
  token1: string;
  amount: bigint;
  slippage: bigint;
  routePlan: bigint[];
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
  tokenBalances: Map<string, bigint>;
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

export interface PositionPath {
  poolId: string;
  owner: string;
  tickLower: bigint;
  tickUpper: bigint;
  acc: bigint;
  iacc0: bigint;
  iacc1: bigint;
  t0: bigint;
  acct0: bigint;
}

export interface CollectProtocolFees {
  token0: string;
  token1: string;
  configIndex: bigint;
  recipient: string;
}

export interface SetRewardParams {
  token0: string;
  token1: string;
  configIndex: bigint;
  rewardToken: string;
  payer: string;
  amount: bigint;
  openTime: bigint;
  endTime: bigint;
}

export interface ExtendRewards {
  token0: string;
  token1: string;
  configIndex: bigint;
  rewardToken: string;
  payer: string;
  amount: bigint;
}

export interface ClmmPoolContractState extends ClmmPoolConfig {
  poolId: string;
  token0Info: TokenInfo;
  token1Info: TokenInfo;
  liquidity: bigint;
  sqrtPriceX96: bigint;
  tick: bigint;
}

export interface ClmmPoolConfig {
  configIndex: bigint;
  tickSpacing: bigint;
  tradingFee: bigint;
  protocolFee: bigint;
}

export const MAX_PIPS = Pool.consts.MAX_PIPS;

export type ClmmPositionInfo = PositionInfo