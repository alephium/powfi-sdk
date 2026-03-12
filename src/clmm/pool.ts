import {
  binToHex,
  contractIdFromAddress,
  encodePrimitiveValues,
  groupOfAddress,
  subContractId,
} from '@alephium/web3';
import { Pool } from 'clmm/artifacts/ts/Pool';
import { TickUtils } from './tick';
import type { ClmmSimulateSwapQuote } from './types';
import { ClmmLiquidityUtils } from './liquidity';
import { MathUtil } from '../common/math';
import { normalizeAddress } from '../common';

export class PoolUtils {
  static getPositionId(
    poolAddress: string,
    owner: string,
    tickLower: bigint,
    tickUpper: bigint,
  ): string {
    const group = groupOfAddress(poolAddress);
    const poolId = binToHex(contractIdFromAddress(poolAddress));
    const normalizedOwner = normalizeAddress(owner, group);
    const path = encodePrimitiveValues([
      { type: 'U256', value: Pool.consts.PathPrefixes.Position },
      { type: 'Address', value: normalizedOwner },
      { type: 'I256', value: tickLower },
      { type: 'I256', value: tickUpper },
    ]);
    return subContractId(poolId, binToHex(path), group);
  }

  static computeSwapStep(
    sqrtPriceX96: bigint,
    sqrtPriceTargetX96: bigint,
    liquidity: bigint,
    amount: bigint,
    feePips: bigint,
  ): [bigint, bigint, bigint, bigint] {
    const zeroForOne = sqrtPriceX96 >= sqrtPriceTargetX96;
    const exactIn = amount >= 0n;
    let amountIn = 0n;
    let amountOut = 0n;
    let feeAmount = 0n;
    let sqrtPriceNextX96 = 0n;
    if (exactIn) {
      amountIn = -ClmmLiquidityUtils.getAmountDelta(
        sqrtPriceTargetX96,
        sqrtPriceX96,
        -liquidity,
        zeroForOne,
      );
      const amountRemainingLessFee = MathUtil.divFloor(
        amount * (Pool.consts.MAX_PIPS - feePips),
        Pool.consts.MAX_PIPS,
      );
      const sqrtPriceRealTargetX96 = TickUtils.getNextSqrtPrice(
        sqrtPriceX96,
        liquidity,
        amountRemainingLessFee,
        zeroForOne,
      );
      sqrtPriceNextX96 =
        amountRemainingLessFee >= amountIn ? sqrtPriceTargetX96 : sqrtPriceRealTargetX96;
    } else {
      amountOut = ClmmLiquidityUtils.getAmountDelta(
        sqrtPriceTargetX96,
        sqrtPriceX96,
        liquidity,
        !zeroForOne,
      );
      const sqrtPriceRealTargetX96 = TickUtils.getNextSqrtPrice(
        sqrtPriceX96,
        liquidity,
        amount,
        !zeroForOne,
      );
      sqrtPriceNextX96 = -amount >= amountOut ? sqrtPriceTargetX96 : sqrtPriceRealTargetX96;
    }
    const max = sqrtPriceTargetX96 == sqrtPriceNextX96;
    if (zeroForOne) {
      const amountIn2 = -ClmmLiquidityUtils.getToken0Delta(
        sqrtPriceNextX96,
        sqrtPriceX96,
        -liquidity,
      );
      const amountOut2 = ClmmLiquidityUtils.getToken1Delta(
        sqrtPriceNextX96,
        sqrtPriceX96,
        liquidity,
      );
      amountIn = max && exactIn ? amountIn : amountIn2;
      amountOut = max && !exactIn ? amountOut : amountOut2;
    } else {
      const amountIn2 = -ClmmLiquidityUtils.getToken1Delta(
        sqrtPriceX96,
        sqrtPriceNextX96,
        -liquidity,
      );
      const amountOut2 = ClmmLiquidityUtils.getToken0Delta(
        sqrtPriceX96,
        sqrtPriceNextX96,
        liquidity,
      );
      amountIn = max && exactIn ? amountIn : amountIn2;
      amountOut = max && !exactIn ? amountOut : amountOut2;
    }
    if (!exactIn && amount > -amountOut) amountOut = -amount;

    if (exactIn && sqrtPriceNextX96 != sqrtPriceTargetX96) {
      feeAmount = amount - amountIn;
    } else {
      feeAmount = -MathUtil.alphDiv(-amountIn * feePips, Pool.consts.MAX_PIPS - feePips);
    }

    return [sqrtPriceNextX96, amountIn, amountOut, feeAmount];
  }

  static offlineSwap(
    liqDist: ClmmSimulateSwapQuote,
    amountSpecified: bigint,
    sqrtPriceX96: bigint,
  ): bigint {
    const exactIn = amountSpecified > 0n;
    let amountCalculated = 0n;
    let liquidity = liqDist.liquidity;
    for (const row of liqDist.rows) {
      const [sqrtPriceNextX96, amountIn, amountOut, feeAmount] = this.computeSwapStep(
        sqrtPriceX96,
        row.sqrtPriceX96,
        liquidity,
        amountSpecified,
        liqDist.fee,
      );
      if (exactIn) {
        amountSpecified -= amountIn + feeAmount;
        amountCalculated -= amountOut;
      } else {
        amountSpecified += amountOut;
        amountCalculated += amountIn + feeAmount;
      }
      sqrtPriceX96 = sqrtPriceNextX96;
      liquidity = row.liquidity;
    }
    return amountCalculated;
  }
}
