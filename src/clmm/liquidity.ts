import type { TokenInfo } from '@alephium/token-list';
import { TickUtils } from './tick';
import { MathUtil } from '../common/math';
import { Q96 } from '../../clmm/artifacts/ts/constants';
import type { GetPositionAmountsFromPriceProps, GetPositionAmountsFromPriceReturn } from './types';

export class ClmmLiquidityUtils {
  static getPositionAmountsFromPrice(
    p: GetPositionAmountsFromPriceProps,
  ): GetPositionAmountsFromPriceReturn {
    if (p.amountBase === 0n || p.amountQuote === 0n) {
      return { newAmountBase: 0n, newAmountQuote: 0n, liquidity: 0n };
    }
    const amounts = [p.amountBase, p.amountQuote];
    const sqrts = [
      TickUtils.getSqrtRatioAtTick(p.lowerTick),
      TickUtils.getSqrtRatioAtTick(p.upperTick),
    ];
    const reverse1 = p.lowerTick > p.upperTick;
    if (reverse1) {
      sqrts.reverse();
    }
    const reverse2 = p.tokenBaseId > p.tokenQuoteId;
    if (reverse2) {
      amounts.reverse();
    }
    const [amount0, amount1, liquidity] = this.getAmountsAndLiquidityAtSqrtPrice(
      p.sqrtRatioX96,
      sqrts[0],
      sqrts[1],
      amounts[0],
      amounts[1],
    );
    return reverse2
      ? { newAmountBase: amount1, newAmountQuote: amount0, liquidity }
      : { newAmountBase: amount0, newAmountQuote: amount1, liquidity };
  }

  static getAmountsAndLiquidityAtPrice(
    currentPrice: number,
    token0: TokenInfo,
    token1: TokenInfo,
    lowerTick: bigint,
    upperTick: bigint,
    amount0: bigint,
    amount1: bigint,
  ): [bigint, bigint, bigint] {
    const sqrtRatioX96 = TickUtils.priceToSqrtPriceX96(
      currentPrice,
      token0.decimals,
      token1.decimals,
    );
    const sqrtRatioAX96 = TickUtils.getSqrtRatioAtTick(lowerTick);
    const sqrtRatioBX96 = TickUtils.getSqrtRatioAtTick(upperTick);
    return this.getAmountsAndLiquidityAtSqrtPrice(
      sqrtRatioX96,
      sqrtRatioAX96,
      sqrtRatioBX96,
      amount0,
      amount1,
    );
  }

  static getAmountsAndLiquidityAtSqrtPrice(
    sqrtRatioX96: bigint,
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    amount0: bigint,
    amount1: bigint,
  ): [bigint, bigint, bigint] {
    const liquidity = this.getLiquidityFromAmounts(
      sqrtRatioX96,
      sqrtRatioAX96,
      sqrtRatioBX96,
      amount0,
      amount1,
    );
    const [a0, a1] = this.getAmountsForLiquidity(
      sqrtRatioX96,
      sqrtRatioAX96,
      sqrtRatioBX96,
      -liquidity,
    );
    return [-a0, -a1, liquidity];
  }

  static getAmountsForLiquidity(
    sqrtRatioX96: bigint,
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    liquidity: bigint,
  ): [bigint, bigint] {
    if (sqrtRatioX96 <= sqrtRatioAX96) {
      const amount0 = this.getToken0Delta(sqrtRatioAX96, sqrtRatioBX96, liquidity);
      return [amount0, 0n];
    } else if (sqrtRatioX96 < sqrtRatioBX96) {
      const amount0 = this.getToken0Delta(sqrtRatioX96, sqrtRatioBX96, liquidity);
      const amount1 = this.getToken1Delta(sqrtRatioAX96, sqrtRatioX96, liquidity);
      return [amount0, amount1];
    } else {
      const amount1 = this.getToken1Delta(sqrtRatioAX96, sqrtRatioBX96, liquidity);
      return [0n, amount1];
    }
  }

  static getLiquidityFromAmounts(
    sqrtRatioX96: bigint,
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    amount0: bigint,
    amount1: bigint,
  ): bigint {
    if (sqrtRatioX96 < sqrtRatioAX96) {
      return this.getLiquidityFromToken0(sqrtRatioAX96, sqrtRatioBX96, amount0);
    } else if (sqrtRatioX96 < sqrtRatioBX96) {
      const liquidity0 = this.getLiquidityFromToken0(sqrtRatioX96, sqrtRatioBX96, amount0);
      const liquidity1 = this.getLiquidityFromToken1(sqrtRatioAX96, sqrtRatioX96, amount1);
      return liquidity0 < liquidity1 ? liquidity0 : liquidity1;
    } else {
      return this.getLiquidityFromToken1(sqrtRatioAX96, sqrtRatioBX96, amount1);
    }
  }

  static getLiquidityFromToken0(
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    amount0: bigint,
  ): bigint {
    const intermediate = MathUtil.alphDiv(sqrtRatioAX96 * sqrtRatioBX96, Q96);
    return MathUtil.alphDiv(amount0 * intermediate, sqrtRatioBX96 - sqrtRatioAX96);
  }

  static getLiquidityFromToken1(
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    amount1: bigint,
  ): bigint {
    return MathUtil.alphDiv(amount1 * Q96, sqrtRatioBX96 - sqrtRatioAX96);
  }

  static getAmountDelta(
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    liquidity: bigint,
    zeroForOne: boolean,
  ): bigint {
    if (zeroForOne) {
      return this.getToken0Delta(sqrtRatioAX96, sqrtRatioBX96, liquidity);
    } else {
      return this.getToken1Delta(sqrtRatioAX96, sqrtRatioBX96, liquidity);
    }
  }

  static getToken0Delta(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, liquidity: bigint): bigint {
    const numerator1 = liquidity * Q96;
    const numerator2 = sqrtRatioBX96 - sqrtRatioAX96;
    return MathUtil.alphDiv(numerator1 * numerator2, sqrtRatioBX96 * sqrtRatioAX96);
  }

  static getToken1Delta(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, liquidity: bigint): bigint {
    return MathUtil.alphDiv(liquidity * (sqrtRatioBX96 - sqrtRatioAX96), Q96);
  }
}
