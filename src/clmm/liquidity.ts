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
    const tokens = [tokenBase, tokenQuote];
    const ticks = [lowerTick, upperTick];
    const amounts = [amountBase, amountQuote];
    const reverse = tokenBase.id > tokenQuote.id != upperTick > lowerTick;
    if (reverse) {
      tokens.reverse();
      ticks.reverse();
      amounts.reverse();
    }
    const price = reverse ? 1 / currentPrice : currentPrice;
    const [amount0, amount1, liquidity] = this.getAmountsAndLiquidityAtPrice(
      price,
      tokens[0],
      tokens[1],
      ticks[0],
      ticks[1],
      amounts[0],
      amounts[1],
    );
    return reverse ? [amount1, amount0, liquidity] : [amount0, amount1, liquidity];
  }

  static getPositionAmountsFromPrice2(
    sqrtRatioX96: bigint,
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
    const amounts = [amountBase, amountQuote];
    const sqrts = [
      TickUtils.getSqrtRatioAtTick(lowerTick),
      TickUtils.getSqrtRatioAtTick(upperTick),
    ];
    const reverse1 = lowerTick > upperTick;
    if (reverse1) {
      sqrts.reverse();
    }
    const reverse2 = tokenBase.id > tokenQuote.id;
    if (reverse2) {
      amounts.reverse();
    }
    const [amount0, amount1, liquidity] = this.getAmountsAndLiquidityAtSqrtPrice(
      sqrtRatioX96,
      sqrts[0],
      sqrts[1],
      amounts[0],
      amounts[1],
    );
    return reverse2 ? [amount1, amount0, liquidity] : [amount0, amount1, liquidity];
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
