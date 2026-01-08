import type { TokenInfo } from '@alephium/token-list';

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
}

export interface SwapParams {
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn?: bigint;
  amountOut?: bigint;
  slippage: bigint; // bps
  sender: string;
  ttl?: number; // Time to live in minutes, default 60
}

export interface SwapDetails {
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

export interface AddLiquidityParams {
  cpmmPoolState: CpmmPoolContractState;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  amountA: bigint;
  amountB: bigint;
  slippage: bigint; // bps
  sender: string;
  ttl?: number;
}

export interface AddLiquidityDetails {
  state?: CpmmPoolContractState;
  tokenAId: string;
  tokenBId: string;
  amountA: bigint;
  amountB: bigint;
  shareAmount: bigint;
  sharePercentage: number;
}

export interface RemoveLiquidityParams {
  state: CpmmPoolContractState;
  liquidity: bigint;
  totalLiquidityAmount?: bigint;
  slippage: bigint; // bps
  sender: string;
  ttl?: number;
}

export interface RemoveLiquidityDetails {
  state: CpmmPoolContractState;
  token0: TokenInfo;
  amount0: bigint;
  token1: TokenInfo;
  amount1: bigint;
  remainShareAmount: bigint;
  remainSharePercentage: number;
}

export interface ClaimableAmounts {
  token0: TokenInfo;
  amount0: bigint;
  token1: TokenInfo;
  amount1: bigint;
}

export interface CreatePoolParams {
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  sender: string;
  tokenAAmount?: bigint;
  tokenBAmount?: bigint;
}

export interface ComputeSwapParams {
  state: CpmmPoolContractState;
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn?: bigint;
  amountOut?: bigint;
  slippage: bigint; // bps
}

export interface ComputeLiquidityParams {
  state?: CpmmPoolContractState;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  amountA?: bigint;
  amountB?: bigint;
  inputType?: 'TokenA' | 'TokenB';
}
