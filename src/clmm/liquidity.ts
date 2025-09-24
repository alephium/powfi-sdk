import type { TokenInfo } from '@alephium/token-list';
import { TickUtils } from './tick';
import { MathUtil } from '../common/math';
import { Q96 } from '../../clmm/artifacts/ts/constants';

export class ClmmLiquidityUtils {
  static getPositionAmountsFromPrice(
    currentPrice: number,
    tokenBase: TokenInfo,
    tokenQuote: TokenInfo,
    lowerTick: bigint,
    upperTick: bigint,
    amountBase: bigint,
    amountQuote: bigint,
  ): [bigint, bigint, bigint] {
    if (amountBase === 0n || amountQuote === 0n) {
      return [0n, 0n, 0n];
    }

    const reverse = tokenBase.id > tokenQuote.id;
    const [token0, token1] = reverse ? [tokenQuote, tokenBase] : [tokenBase, tokenQuote];
    const [amount0, amount1] = reverse ? [amountQuote, amountBase] : [amountBase, amountQuote];
    const [adjustedLowerTick, adjustedUpperTick] = reverse
      ? [upperTick, lowerTick]
      : [lowerTick, upperTick];
    const adjustedPrice = reverse ? 1 / currentPrice : currentPrice;

    const [adjustedAmount0, adjustedAmount1, liquidity] = this.getAmountsAndLiquidityAtPrice(
      adjustedPrice,
      token0,
      token1,
      adjustedLowerTick,
      adjustedUpperTick,
      amount0,
      amount1,
    );
    return reverse
      ? [adjustedAmount1, adjustedAmount0, liquidity]
      : [adjustedAmount0, adjustedAmount1, liquidity];
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
    const { price } = TickUtils.getPriceAndTick(
      currentPrice,
      token0.decimals,
      token1.decimals,
      true,
    );
    const sqrtRatioX96 = TickUtils.priceToSqrtPriceX96(price, token0.decimals, token1.decimals);
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
    const intermediate = MathUtil.divFloor(sqrtRatioAX96 * sqrtRatioBX96, Q96);
    return MathUtil.divFloor(amount0 * intermediate, sqrtRatioBX96 - sqrtRatioAX96);
  }

  static getLiquidityFromToken1(
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    amount1: bigint,
  ): bigint {
    return MathUtil.divFloor(amount1 * Q96, sqrtRatioBX96 - sqrtRatioAX96);
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
    return MathUtil.divFloor(numerator1 * numerator2, sqrtRatioBX96 * sqrtRatioAX96);
  }

  static getToken1Delta(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, liquidity: bigint): bigint {
    return MathUtil.divFloor(liquidity * (sqrtRatioBX96 - sqrtRatioAX96), Q96);
  }
}
