import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  Q128,
  Q32,
  Q64,
  Q96,
} from 'clmm/artifacts/ts/constants';
import { U256_MAX } from './constants';
import Decimal from 'decimal.js';
import { MathUtil } from '../common/math';
import { BPS } from '../common/constants';
import type { TokenInfo } from '@alephium/token-list';

export class TickUtils {
  static getSqrtRatioAtTick(tick: bigint): bigint {
    const absTick = tick < 0n ? -tick : tick;
    if (absTick > MAX_TICK) {
      throw new Error(`TickOutOfBounds: ${tick}`);
    }

    let ratio = (absTick & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : Q128;

    if ((absTick & 0x2n) !== 0n) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
    if ((absTick & 0x4n) !== 0n) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
    if ((absTick & 0x8n) !== 0n) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
    if ((absTick & 0x10n) !== 0n) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
    if ((absTick & 0x20n) !== 0n) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
    if ((absTick & 0x40n) !== 0n) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
    if ((absTick & 0x80n) !== 0n) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
    if ((absTick & 0x100n) !== 0n) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
    if ((absTick & 0x200n) !== 0n) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
    if ((absTick & 0x400n) !== 0n) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
    if ((absTick & 0x800n) !== 0n) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
    if ((absTick & 0x1000n) !== 0n) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
    if ((absTick & 0x2000n) !== 0n) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
    if ((absTick & 0x4000n) !== 0n) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
    if ((absTick & 0x8000n) !== 0n) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
    if ((absTick & 0x10000n) !== 0n) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
    if ((absTick & 0x20000n) !== 0n) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
    if ((absTick & 0x40000n) !== 0n) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
    if ((absTick & 0x80000n) !== 0n) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;

    if (tick > 0n) {
      ratio = U256_MAX / ratio;
    }

    return ratio >> 32n;
  }

  static getTickAtSqrtRatio(sqrtPriceX96: bigint): bigint {
    if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) {
      throw new Error('SqrtPriceX96OutOfBounds');
    }

    const ratio = sqrtPriceX96 << 32n;
    let r = ratio;
    let msb = 0n;

    if (r > Q128 - 1n) {
      msb |= 0x80n;
      r >>= 0x80n;
    }
    if (r > Q64 - 1n) {
      msb |= 0x40n;
      r >>= 0x40n;
    }
    if (r > Q32 - 1n) {
      msb |= 0x20n;
      r >>= 0x20n;
    }
    if (r > 0xffffn) {
      msb |= 0x10n;
      r >>= 0x10n;
    }
    if (r > 0xffn) {
      msb |= 0x8n;
      r >>= 0x8n;
    }
    if (r > 0xfn) {
      msb |= 0x4n;
      r >>= 0x4n;
    }
    if (r > 0x3n) {
      msb |= 0x2n;
      r >>= 0x2n;
    }
    if (r > 0x1n) {
      msb |= 0x1n;
    }

    if (msb >= 128n) {
      r = ratio >> (msb - 127n);
    } else {
      r = ratio << (127n - msb);
    }

    let log_2 = (msb - 128n) << 64n;

    for (let i = 63n; i >= 50n; i--) {
      r = (r * r) >> 127n;
      const f = r >> 128n;
      log_2 |= f << i;
      r >>= f;
    }

    const log_sqrt10001 = log_2 * 255738958999603826347141n;

    const tickLow = (log_sqrt10001 - 3402992956809132418596140100660247210n) >> 128n;
    const tickHi = (log_sqrt10001 + 291339464771989622907027621153398088495n) >> 128n;

    if (tickLow === tickHi) {
      return tickLow;
    } else {
      if (this.getSqrtRatioAtTick(tickHi) <= sqrtPriceX96) {
        return tickHi;
      } else {
        return tickLow;
      }
    }
  }

  static priceToSqrtPriceX96(
    price: Decimal.Value,
    token0Decimal: number,
    token1Decimal: number,
  ): bigint {
    const priceDecimal = new Decimal(price);
    if (!priceDecimal.isFinite() || priceDecimal.lte(0)) {
      throw new Error('Invalid price input');
    }

    const token0Unit = 10n ** BigInt(token0Decimal);
    const token1Amount = BigInt(
      priceDecimal
        .mul(10n ** BigInt(token1Decimal))
        .floor()
        .toFixed(),
    );
    return this.priceSqrt(token1Amount, token0Unit);
  }

  static sqrtPriceX96ToPrice(
    sqrtPriceX96: bigint,
    token0Decimal: number,
    token1Decimal: number,
  ): number {
    if (sqrtPriceX96 < 0n) {
      throw new Error('Invalid sqrtPriceX96');
    }

    const sqrtPriceDecimal = new Decimal(sqrtPriceX96.toString());
    const q96Decimal = new Decimal(Q96.toString());
    let priceDecimal = sqrtPriceDecimal.div(q96Decimal).pow(2);

    const exponentDiff = token0Decimal - token1Decimal;
    if (exponentDiff !== 0) {
      const factor = new Decimal(10).pow(Math.abs(exponentDiff));
      priceDecimal = exponentDiff > 0 ? priceDecimal.mul(factor) : priceDecimal.div(factor);
    }

    if (!priceDecimal.isFinite()) {
      throw new Error('Price overflow');
    }

    return priceDecimal.toNumber();
  }

  static getAlignedTick(
    price: number,
    token0Decimal: number,
    token1Decimal: number,
    tickSpacing: bigint,
  ): bigint {
    const sqrtPriceX96 = this.priceToSqrtPriceX96(price, token0Decimal, token1Decimal);
    const tick0 = this.getTickAtSqrtRatio(sqrtPriceX96);

    return MathUtil.alphCeil(tick0, tickSpacing) * tickSpacing;
  }

  static getNextTick(
    tick: bigint,
    tickSpacing: bigint,
    tokenBase: TokenInfo,
    tokenQuote: TokenInfo,
    baseIn: boolean,
    isAdd: boolean,
  ): bigint {
    const reverse = tokenBase.id > tokenQuote.id == baseIn;
    const delta = isAdd == reverse ? tickSpacing : -tickSpacing;
    return tick + delta;
  }

  static getAlignedPrice(
    priceIn: number,
    tokenBase: TokenInfo,
    tokenQuote: TokenInfo,
    tickSpacing: bigint,
    baseIn: boolean,
  ): { tick: bigint; price: number } {
    const reverse = tokenBase.id > tokenQuote.id == baseIn;
    const [token0, token1] = reverse ? [tokenQuote, tokenBase] : [tokenBase, tokenQuote];

    const rawPrice = reverse ? 1 / priceIn : priceIn;
    const tick = this.getAlignedTick(rawPrice, token0.decimals, token1.decimals, tickSpacing);
    return this.getPriceFromTick(tick, tokenBase, tokenQuote, baseIn);
  }

  static getPriceFromTick(
    tick: bigint,
    tokenBase: TokenInfo,
    tokenQuote: TokenInfo,
    baseIn: boolean,
  ): { tick: bigint; price: number } {
    const reverse = tokenBase.id > tokenQuote.id == baseIn;
    const [token0, token1] = reverse ? [tokenQuote, tokenBase] : [tokenBase, tokenQuote];

    const sqrtPriceX96 = this.getSqrtRatioAtTick(tick);
    const alignedPrice = this.sqrtPriceX96ToPrice(sqrtPriceX96, token0.decimals, token1.decimals);
    const price = reverse ? 1 / alignedPrice : alignedPrice;
    return { tick, price };
  }

  static getMinPriceFromTick(
    tokenBase: TokenInfo,
    tokenQuote: TokenInfo,
    tickSpacing: bigint,
    baseIn: boolean,
  ): { tick: bigint; price: number } {
    const reverse = tokenBase.id > tokenQuote.id == baseIn;
    const rawTick = reverse ? MAX_TICK : MIN_TICK;
    const tick = (rawTick / tickSpacing) * tickSpacing;
    return this.getPriceFromTick(tick, tokenBase, tokenQuote, baseIn);
  }

  static getMaxPriceFromTick(
    tokenBase: TokenInfo,
    tokenQuote: TokenInfo,
    tickSpacing: bigint,
    baseIn: boolean,
  ): { tick: bigint; price: number } {
    const reverse = tokenBase.id > tokenQuote.id == baseIn;
    const rawTick = reverse ? MIN_TICK : MAX_TICK;
    const tick = (rawTick / tickSpacing) * tickSpacing;
    return this.getPriceFromTick(tick, tokenBase, tokenQuote, baseIn);
  }

  static getNextSqrtPriceFromAmount0(
    sqrtPriceX96: bigint,
    liquidity: bigint,
    amount: bigint,
  ): bigint {
    const numerator1 = liquidity * Q96;
    const product = amount * sqrtPriceX96;
    const denominator = numerator1 - product;
    if (denominator <= 0n) {
      throw new Error('Amount0 exceeds available liquidity for the swap');
    }
    return -MathUtil.alphDiv(-numerator1 * sqrtPriceX96, denominator);
  }

  static getNextSqrtPriceFromAmount1(
    sqrtPriceX96: bigint,
    liquidity: bigint,
    amount: bigint,
  ): bigint {
    const quotient = MathUtil.alphDiv(amount * Q96, liquidity);
    return sqrtPriceX96 + quotient;
  }

  static getNextSqrtPrice(
    sqrtPX96: bigint,
    liquidity: bigint,
    amount: bigint,
    zeroForOne: boolean,
  ): bigint {
    if (zeroForOne) {
      return this.getNextSqrtPriceFromAmount0(sqrtPX96, liquidity, amount);
    } else {
      return this.getNextSqrtPriceFromAmount1(sqrtPX96, liquidity, amount);
    }
  }

  static getSqrtPriceLimitX96(sqrtPriceX96: bigint, slippage: bigint, zeroForOne: boolean): bigint {
    if (slippage <= 0n || slippage >= BPS) {
      throw new Error('slippageBps must be in (0, 10000)');
    }

    const [minBound, maxBound] = this.getSqrtPriceX96Bounds(sqrtPriceX96, slippage);
    let limit = zeroForOne ? minBound : maxBound;

    if (zeroForOne) {
      if (limit >= sqrtPriceX96) limit = sqrtPriceX96 - 1n;
      if (limit <= MIN_SQRT_RATIO) limit = MIN_SQRT_RATIO + 1n;
    } else {
      if (limit <= sqrtPriceX96) limit = sqrtPriceX96 + 1n;
      if (limit >= MAX_SQRT_RATIO) limit = MAX_SQRT_RATIO - 1n;
    }
    return limit;
  }

  // Compute slippage bounds for a given sqrt price
  // The slippage is in bps.
  // Returns [minSqrtPriceX96, maxSqrtPriceX96], where:
  //   min = floor(sqrtPriceX96 * sqrt(1 - slippage))
  //   max = ceil(sqrtPriceX96 * sqrt(1 + slippage))
  // `slippage` is bps: e.g., 100 for 1%, 30 for 0.3%
  static getSqrtPriceX96Bounds(sqrtPriceX96: bigint, slippage: bigint): [bigint, bigint] {
    if (slippage < 0n || slippage >= BPS) {
      throw new Error('Invalid slippageBps; must be in [0, 10000)');
    }
    const price = sqrtPriceX96 * sqrtPriceX96;
    const minSqrtPriceX96 = MathUtil.sqrt(price * (BPS - slippage) / BPS);
    const maxSqrtPriceX96 = MathUtil.sqrt(price * (BPS + slippage) / BPS);
    return [minSqrtPriceX96, maxSqrtPriceX96];
  }

  private static priceSqrt(r1: bigint, r0: bigint): bigint {
    return MathUtil.sqrt(MathUtil.divFloor(r1 * Q96 * Q96, r0));
  }
}
