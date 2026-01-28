import {
  binToHex,
  contractIdFromAddress,
  encodePrimitiveValues,
  groupOfAddress,
  isGrouplessAddressWithoutGroupIndex,
  subContractId,
} from '@alephium/web3';
import { Pool } from 'clmm/artifacts/ts/Pool';
import { TickUtils } from './tick';
import type { LiquidityDistribution } from './types';
import { ClmmLiquidityUtils } from './liquidity';
import { MathUtil } from '../common/math';

function normalizeAddress(address: string, group: number): string {
  return isGrouplessAddressWithoutGroupIndex(address) ? `${address}:${group}` : address;
}

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
    const zeroForOne = sqrtPriceX96 < sqrtPriceTargetX96;
    const exactIn = amount > 0n;
    let amountIn = 0n;
    let amountOut = 0n;
    let feeAmount = 0n;
    let sqrtPriceNextX96 = 0n;
    if (exactIn) {
      amountIn = -ClmmLiquidityUtils.getAmountDelta(
        sqrtPriceX96,
        sqrtPriceTargetX96,
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
        zeroForOne,
      );
      const sqrtPriceRealTargetX96 = TickUtils.getNextSqrtPrice(
        sqrtPriceX96,
        liquidity,
        amount,
        zeroForOne,
      );
      sqrtPriceNextX96 = -amount >= amountOut ? sqrtPriceTargetX96 : sqrtPriceRealTargetX96;
    }
    const max = sqrtPriceTargetX96 == sqrtPriceNextX96;
    if (zeroForOne) {
      const amountIn2 = -ClmmLiquidityUtils.getAmountDelta(
        sqrtPriceNextX96,
        sqrtPriceX96,
        -liquidity,
        zeroForOne,
      );
      const amountOut2 = ClmmLiquidityUtils.getAmountDelta(
        sqrtPriceNextX96,
        sqrtPriceX96,
        liquidity,
        zeroForOne,
      );
      amountIn = max && exactIn ? amountIn : amountIn2;
      amountOut = max && !exactIn ? amountOut : amountOut2;
    } else {
      const amountIn2 = -ClmmLiquidityUtils.getAmountDelta(
        sqrtPriceX96,
        sqrtPriceNextX96,
        -liquidity,
        zeroForOne,
      );
      const amountOut2 = ClmmLiquidityUtils.getAmountDelta(
        sqrtPriceX96,
        sqrtPriceNextX96,
        liquidity,
        zeroForOne,
      );
      amountIn = max && exactIn ? amountIn : amountIn2;
      amountOut = max && !exactIn ? amountOut : amountOut2;
    }
    if (!exactIn && amount > -amountOut) amountOut = -amount;

    if (exactIn && sqrtPriceNextX96 != sqrtPriceTargetX96) {
      feeAmount = amount - amountIn;
    } else {
      feeAmount = MathUtil.divFloor(amountIn * feePips, Pool.consts.MAX_PIPS - feePips);
    }

    return [sqrtPriceNextX96, amountIn, amountOut, feeAmount];
  }

  static offlineSwap(
    liqDist: LiquidityDistribution,
    amountSpecified: bigint,
    sqrtPriceX96: bigint,
  ): bigint {
    const exactIn = amountSpecified > 0n;
    let amountCalculated = 0n;
    for (const row of liqDist.rows) {
      const [sqrtPriceNextX96, amountIn, amountOut, feeAmount] = this.computeSwapStep(
        sqrtPriceX96,
        row.sqrtPriceX96,
        liqDist.liquidity,
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
    }
    return amountCalculated;
  }
}
