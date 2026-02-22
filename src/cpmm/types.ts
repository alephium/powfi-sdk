import type { TokenInfo } from '@alephium/token-list';

export type CpmmTokenId = string;
export type CpmmSlippageBps = bigint;
export type CpmmInputType = 'TokenA' | 'TokenB';

export interface CpmmConfig {
  groupIndex: number;
  factoryId: string;
  routerId: string;
  feeCollectorFactoryId?: string;
}

export interface CpmmPoolContractState {
  poolId: string;
  reserve0: bigint;
  reserve1: bigint;
  token0Info: TokenInfo;
  token1Info: TokenInfo;
  totalSupply: bigint;
  dexAccount: string;
}

export interface CpmmSwapRequest {
  tokenInId: CpmmTokenId;
  tokenOutId: CpmmTokenId;
  amountIn?: bigint;
  amountOut?: bigint;
  slippageBps: CpmmSlippageBps;
  sender: string;
  ttlMinutes?: number; // defaults to 60
}

export interface CpmmSwapQuoteParams {
  state: CpmmPoolContractState;
  tokenInId: CpmmTokenId;
  tokenOutId: CpmmTokenId;
  amountIn?: bigint;
  amountOut?: bigint;
  slippageBps: CpmmSlippageBps;
}

export interface CpmmSwapQuote {
  swapType: 'ExactIn' | 'ExactOut';
  state: CpmmPoolContractState;
  tokenInInfo: TokenInfo;
  tokenOutInfo: TokenInfo;
  tokenInAmount: bigint;
  maximalTokenInAmount: bigint | undefined;
  tokenOutAmount: bigint;
  minimalTokenOutAmount: bigint | undefined;
  priceImpact: number;
}

export interface CpmmAddLiquidityRequest {
  poolState: CpmmPoolContractState;
  tokenAId: CpmmTokenId;
  tokenBId: CpmmTokenId;
  amountA: bigint;
  amountB: bigint;
  slippageBps: CpmmSlippageBps;
  sender: string;
  ttlMinutes?: number; // defaults to 60
}

export interface CpmmAddLiquidityQuoteParams {
  poolState?: CpmmPoolContractState;
  tokenAId: CpmmTokenId;
  tokenBId: CpmmTokenId;
  amountA?: bigint;
  amountB?: bigint;
  inputType?: CpmmInputType;
}

export interface CpmmAddLiquidityQuote {
  state?: CpmmPoolContractState;
  tokenAId: string;
  tokenBId: string;
  amountA: bigint;
  amountB: bigint;
  shareAmount: bigint;
  sharePercentage: number;
}

export interface CpmmRemoveLiquidityRequest {
  poolState: CpmmPoolContractState;
  liquidity: bigint;
  totalLiquidityAmount?: bigint;
  slippageBps: CpmmSlippageBps;
  sender: string;
  ttlMinutes?: number; // defaults to 60
}

export interface CpmmRemoveLiquidityQuote {
  state: CpmmPoolContractState;
  token0: TokenInfo;
  amount0: bigint;
  token1: TokenInfo;
  amount1: bigint;
  remainShareAmount: bigint;
  remainSharePercentage: number;
}

export interface CpmmClaimableAmounts {
  token0: TokenInfo;
  amount0: bigint;
  token1: TokenInfo;
  amount1: bigint;
}

export interface CpmmCreatePoolRequest {
  tokenAId: CpmmTokenId;
  tokenBId: CpmmTokenId;
  sender: string;
  initialLiquidity?: {
    tokenAAmount: bigint;
    tokenBAmount: bigint;
  };
}
