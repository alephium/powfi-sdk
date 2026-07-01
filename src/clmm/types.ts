import type { TokenInfo } from '@alephium/token-list'
import { Pool } from 'clmm/artifacts/ts/Pool'
import type { PositionInfo } from 'clmm/artifacts/ts/types'

export interface ClmmConfig {
  groupIndex: number
  factoryId: string
  positionManagerId: string
  defaultConfigIndex: bigint
  accountRoot: string
}

export interface ClmmSwapRequest {
  token0: string
  token1: string
  amount: bigint
  amountIn: bigint
  slippage: bigint
  routePlan: bigint[]
}

export interface ClmmSwapToRequest {
  tokenIn: string
  tokenOut: string
  configIndex: bigint
  targetSqrtPriceX96: bigint
  amountInMax: bigint
}

export interface ClmmSimulateSwapParams {
  configIndex: bigint
  token0: string
  token1: string
  zeroForOne: boolean
  amount: bigint
  data?: string
  interestedContracts?: string[]
}

export interface LiquidityForPrice {
  liquidity: bigint
  sqrtPriceX96: bigint
}

export interface ClmmSimulateSwapQuote {
  baseSqrtPriceX96: bigint
  sqrtPriceX96: bigint
  liquidity: bigint
  fee: bigint
  rows: Array<LiquidityForPrice>
}

export interface ClmmAddLiquidityRequest {
  token0: string
  token1: string
  configIndex: bigint
  owner?: string
  tickLower: bigint
  tickUpper: bigint
  slippage: bigint
  amount0: bigint
  amount1: bigint
  existingPosition?: boolean
}

export interface ClmmRemoveLiquidityRequest {
  token0: string
  token1: string
  configIndex: bigint
  owner: string
  tickLower: bigint
  tickUpper: bigint
  liquidity: bigint
  base: 'token0' | 'token1'
  baseAmount: bigint
  otherAmountMax: bigint
}

export interface ClmmCollectTokensRequest {
  token0: string
  token1: string
  configIndex: bigint
  owner: string
  recipient: string
  tickLower: bigint
  tickUpper: bigint
  liquidity: bigint // != 0 if also remove liquidity
  amount0Max: bigint
  amount1Max: bigint
}

export interface ClmmPositionInfoRequest {
  poolId: string
  owner: string
  tickLower: bigint
  tickUpper: bigint
  acc: bigint
  iacc0: bigint
  iacc1: bigint
  t0: bigint
  acct0: bigint
}

export interface ClmmCollectProtocolFeesRequest {
  token0: string
  token1: string
  configIndex: bigint
  tokenId: string
}

export interface ClmmSetRewardParamsRequest {
  token0: string
  token1: string
  configIndex: bigint
  rewardToken: string
  payer: string
  amount: bigint
  openTime: bigint
  endTime: bigint
}

export interface ClmmExtendRewardsRequest {
  token0: string
  token1: string
  configIndex: bigint
  rewardToken: string
  payer: string
  amount: bigint
}

export interface ClmmRewardInfo {
  amount: bigint
  openTime: bigint
  endTime: bigint
}

export interface ClmmPoolRewardState {
  token2Info: TokenInfo
  rewardInfos: ClmmRewardInfo[]
}

export interface ClmmPoolContractState extends ClmmPoolConfig {
  poolId: string
  token0Info: TokenInfo
  token1Info: TokenInfo
  liquidity: bigint
  sqrtPriceX96: bigint
  tick: bigint
}

export interface ClmmPoolConfig {
  configIndex: bigint
  tickSpacing: bigint
  tradingFee: bigint
  protocolFee: bigint
}

export const MAX_PIPS = Pool.consts.MAX_PIPS

export type ClmmPositionInfo = PositionInfo

export interface GetPositionAmountsFromPriceProps {
  sqrtRatioX96: bigint
  tokenBaseId: string
  tokenQuoteId: string
  lowerTick: bigint
  upperTick: bigint
  amountBase: bigint
  amountQuote: bigint
}

export interface GetPositionAmountsFromPriceReturn {
  newAmountBase: bigint
  newAmountQuote: bigint
  liquidity: bigint
}
