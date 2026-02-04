import { BPS } from '../../src';
import { TickUtils } from '../../src/clmm/tick';
import {
  MIN_SQRT_RATIO,
  MAX_SQRT_RATIO,
  Q96,
  MAX_TICK,
  MIN_TICK,
} from 'clmm/artifacts/ts/constants';

describe('TickUtils', () => {
  const createToken = (id: string, decimals: number) => ({
    id,
    decimals,
    symbol: 'TEST',
    name: 'Test Token',
    description: 'Test token',
    logoURI: '',
  });

  describe('sqrt ratio & tick conversions', () => {
    it('returns expected ratios between ticks', () => {
      const zeroTickRatio = TickUtils.getSqrtRatioAtTick(0n);
      expect(zeroTickRatio).toBe(Q96);

      const tickOneRatio = TickUtils.getSqrtRatioAtTick(1n);
      const tickMinusOneRatio = TickUtils.getSqrtRatioAtTick(-1n);

      const ratioUp = Number(tickOneRatio) / Number(zeroTickRatio);
      const ratioDown = Number(zeroTickRatio) / Number(tickMinusOneRatio);
      expect(Math.pow(ratioUp, 2)).toBeCloseTo(1.0001, 6);
      expect(Math.pow(ratioDown, 2)).toBeCloseTo(1.0001, 6);

      const step = Math.pow(1.0001, 0.5);
      let previous = zeroTickRatio;
      for (let tick = 1n; tick <= 100n; tick++) {
        const ratio = TickUtils.getSqrtRatioAtTick(tick);
        const ratioStep = Number(ratio) / Number(previous);
        expect(ratioStep).toBeCloseTo(step, 6);
        previous = ratio;
      }
    });

    it('handles boundary ticks', () => {
      const minRatio = TickUtils.getSqrtRatioAtTick(MIN_TICK);
      expect(minRatio).toBe(MIN_SQRT_RATIO - 1n);

      const maxRatio = TickUtils.getSqrtRatioAtTick(MAX_TICK);
      expect(maxRatio).toBe(MAX_SQRT_RATIO - 1n);

      expect(() => TickUtils.getSqrtRatioAtTick(MIN_TICK - 1n)).toThrow('TickOutOfBounds');
      expect(() => TickUtils.getSqrtRatioAtTick(MAX_TICK + 1n)).toThrow('TickOutOfBounds');
    });

    it('round trips sqrt ratios back to ticks with zero error', () => {
      const ticks = new Set<bigint>([0n]);

      for (let i = 0; i <= 5; i++) {
        const magnitude = 10n ** BigInt(i);
        ticks.add(magnitude);
        ticks.add(-magnitude);
      }

      for (const tick of ticks) {
        const sqrtRatio = TickUtils.getSqrtRatioAtTick(tick);
        const recoveredTick = TickUtils.getTickAtSqrtRatio(sqrtRatio);
        expect(recoveredTick).toBe(tick);
      }
    });

    it('handles zero and boundary ratios', () => {
      const zeroTickRatio = TickUtils.getSqrtRatioAtTick(0n);
      expect(TickUtils.getTickAtSqrtRatio(zeroTickRatio)).toBe(0n);

      expect(TickUtils.getTickAtSqrtRatio(MIN_SQRT_RATIO)).toBe(MIN_TICK);
      expect(TickUtils.getTickAtSqrtRatio(MAX_SQRT_RATIO - 1n)).toBe(MAX_TICK);

      expect(() => TickUtils.getTickAtSqrtRatio(MIN_SQRT_RATIO - 1n)).toThrow();
      expect(() => TickUtils.getTickAtSqrtRatio(MAX_SQRT_RATIO)).toThrow();
    });

    it('tests for some common tick values', () => {
      const ticks = [-276_324n, -138_162n, 0n, 138_162n, 276_324n];
      for (const tick of ticks) {
        const sqrtRatio = TickUtils.getSqrtRatioAtTick(tick);
        expect(TickUtils.getTickAtSqrtRatio(sqrtRatio)).toBe(tick);
      }
    });
  });

  describe('price & sqrt ratio conversions', () => {
    it('converts price to sqrt ratio with acceptable error', () => {
      const testCases = [
        { price: 0.001, decimalsA: 6, decimalsB: 6 },
        { price: 0.01, decimalsA: 6, decimalsB: 6 },
        { price: 0.1, decimalsA: 6, decimalsB: 6 },
        { price: 1, decimalsA: 6, decimalsB: 6 },
        { price: 10, decimalsA: 6, decimalsB: 6 },
        { price: 1_000, decimalsA: 6, decimalsB: 6 },
        { price: 10_000, decimalsA: 6, decimalsB: 6 },
        { price: 1.234567, decimalsA: 18, decimalsB: 6 },
        { price: 1.234567, decimalsA: 6, decimalsB: 18 },
        { price: 1.234567, decimalsA: 8, decimalsB: 8 },
        { price: 1.234567, decimalsA: 9, decimalsB: 18 },
      ];

      for (const { price, decimalsA, decimalsB } of testCases) {
        const sqrtPriceX96 = TickUtils.priceToSqrtPriceX96(price, decimalsA, decimalsB);
        expect(sqrtPriceX96).toBeGreaterThan(0n);

        const recoveredPrice = TickUtils.sqrtPriceX96ToPrice(sqrtPriceX96, decimalsA, decimalsB);
        expect(recoveredPrice).toBeGreaterThan(0);
        const relativeError = Math.abs(price - recoveredPrice) / price;
        expect(relativeError).toBeLessThan(0.01);
      }
    });
  });

  describe('getTickWithPrice', () => {
    it('aligns ticks to spacing and rounds in the expected direction', () => {
      const scenarios = [
        { price: 1.0, spacing: 10n, decimals: [6, 6] as const, expected: 0n },
        { price: 2.5, spacing: 60n, decimals: [6, 6] as const, expected: 9180n },
        { price: 0.5, spacing: 200n, decimals: [6, 6] as const, expected: -7000n },
        { price: 0.1, spacing: 10n, decimals: [6, 6] as const, expected: -23030n },
        { price: 500, spacing: 10n, decimals: [18, 6] as const, expected: -214180n },
      ];

      for (const { price, spacing, decimals, expected } of scenarios) {
        const tokenBase = createToken('11', decimals[0]);
        const tokenQuote = createToken('12', decimals[1]);
        const priceInfo = TickUtils.getAlignedPrice(price, tokenBase, tokenQuote, spacing, true);
        expect(priceInfo.tick % spacing).toBe(0n);
        expect(priceInfo.tick).toBe(expected);
        expect(priceInfo.price).toBeCloseTo(price, 0);
        const tick = expected;

        const sqrtPrice = TickUtils.priceToSqrtPriceX96(price, decimals[0], decimals[1]);
        const rawTick = TickUtils.getTickAtSqrtRatio(sqrtPrice);
        const diff = tick - rawTick;
        const absDiff = diff >= 0n ? diff : -diff;
        expect(absDiff <= spacing).toBe(true);
        if (tick >= 0n) {
          expect(diff).toBeGreaterThanOrEqual(0n);
        } else {
          expect(diff).toBeLessThanOrEqual(0n);
        }

        const tickPrice = TickUtils.sqrtPriceX96ToPrice(
          TickUtils.getSqrtRatioAtTick(tick),
          decimals[0],
          decimals[1],
        );
        const relativeError = Math.abs(tickPrice - price) / price;
        expect(relativeError).toBeLessThan(0.01);
        if (tick >= 0n) {
          expect(tickPrice).toBeGreaterThanOrEqual(price);
        } else {
          expect(tickPrice).toBeLessThanOrEqual(price);
        }
      }
    });
  });

  describe('getNextSqrtPrice', () => {
    it('adjusts price directionally based on signed amounts and swap orientation', () => {
      const startingPrice = 1;
      const sqrtPriceX96 = TickUtils.priceToSqrtPriceX96(startingPrice, 6, 6);
      const liquidity = 1_000_000n;
      const scenarios = [
        { amount: 100n, zeroForOne: true, expected: 1.00020003 },
        { amount: -100n, zeroForOne: true, expected: 0.99980003 },
        { amount: 250n, zeroForOne: false, expected: 1.00050006 },
        { amount: -250n, zeroForOne: false, expected: 0.99950006 },
      ];

      for (const { amount, zeroForOne, expected } of scenarios) {
        const nextSqrt = TickUtils.getNextSqrtPrice(sqrtPriceX96, liquidity, amount, zeroForOne);
        const nextPrice = TickUtils.sqrtPriceX96ToPrice(nextSqrt, 6, 6);
        expect(nextPrice).toBeCloseTo(expected, 8);
      }
    });

    it('throws when amount exceeds available liquidity', () => {
      const sqrtPriceX96 = Q96;
      const liquidity = 5n;
      const amount = 5n;
      expect(() => TickUtils.getNextSqrtPrice(sqrtPriceX96, liquidity, amount, true)).toThrow(
        'Amount0 exceeds available liquidity',
      );
    });
  });

  describe('getPriceAndTick & getTickPrice', () => {
    it('getPriceAndTick returns values consistent with direction', () => {
      const price = 1.5;
      const tokenBase = createToken('11', 6);
      const tokenQuote = createToken('12', 6);
      const result = TickUtils.getAlignedPrice(price, tokenBase, tokenQuote, 1n, true);
      expect(result.tick).toBe(4054n);
      expect(result.price).toBeCloseTo(price, 1);
    });

    it('getPriceAndTick respects baseIn flag', () => {
      const price = 2.0;
      const tokenBase = createToken('11', 6);
      const tokenQuote = createToken('12', 6);
      const baseIn = TickUtils.getAlignedPrice(1 / price, tokenBase, tokenQuote, 1n, true);
      const baseOut = TickUtils.getAlignedPrice(price, tokenBase, tokenQuote, 1n, false);
      const tickDiff = baseIn.tick - baseOut.tick;
      expect(tickDiff >= -10n && tickDiff <= 10n).toBe(true);
    });

    it('getTickPrice returns consistent price and sqrt ratio', () => {
      const tick = 1_000n;
      const tokenBase = createToken('11', 6);
      const tokenQuote = createToken('12', 6);

      const baseIn = TickUtils.getPriceFromTick(tick, tokenBase, tokenQuote, true);
      expect(baseIn.tick).toBe(tick);
      expect(baseIn.price).toBeCloseTo(1.10516539, 8);

      const baseOut = TickUtils.getPriceFromTick(tick, tokenBase, tokenQuote, false);
      expect(baseOut.tick).toBe(tick);
      expect(baseOut.price).toBeCloseTo(1 / baseIn.price, 8);
    });
  });

  describe('getPriceAndTickFromBaseQuote', () => {
    it('maintains price as tokenA/tokenB regardless of ordering', () => {
      const tokenA = createToken('0x200', 6);
      const tokenB = createToken('0x100', 6);
      const price = 1.5;

      const result = TickUtils.getAlignedPrice(price, tokenA, tokenB, 1n, true);
      expect(result.price).toBeCloseTo(1.5, 2);
      expect(result.tick).toBeDefined();
    });

    it('handles different decimals', () => {
      const tokenA = createToken('0x200', 18);
      const tokenB = createToken('0x100', 6);
      const price = 2_000;

      const result = TickUtils.getAlignedPrice(price, tokenA, tokenB, 1n, true);
      expect(result.price).toBeCloseTo(2_000, -2);
      expect(result.tick).toBeGreaterThan(0n);
    });

    it('matches direct getPriceAndTick call', () => {
      const tokenA = createToken('0x200', 6);
      const tokenB = createToken('0x100', 6);
      const price = 2.0;

      const fromTokenInfo = TickUtils.getAlignedPrice(price, tokenA, tokenB, 1n, true);
      const direct = TickUtils.getAlignedPrice(price, tokenB, tokenA, 1n, false);

      expect(Number(fromTokenInfo.tick)).toBe(Number(direct.tick));
      expect(fromTokenInfo.price).toBeCloseTo(direct.price, 2);
    });
  });

  describe('getSqrtPriceLimitX96', () => {
    it('returns correct bounds', () => {
      const sqrtPriceX96 = Q96;
      const slippage = BPS / 4n;
      const [minBound, maxBound] = TickUtils.getSqrtPriceX96Bounds(sqrtPriceX96, slippage);
      expect(minBound).toBe(TickUtils.priceToSqrtPriceX96(0.75, 6, 6));
      expect(maxBound).toBe(TickUtils.priceToSqrtPriceX96(1.25, 6, 6));
    });
  });

  describe('getTickPriceFromBaseQuote', () => {
    it('returns consistent values regardless of ordering', () => {
      const tokenBase = createToken('0x200', 6);
      const tokenQuote = createToken('0x100', 6);
      const tick = 1_000n;

      const result = TickUtils.getPriceFromTick(tick, tokenBase, tokenQuote, true);
      expect(result.price).toBeCloseTo(0.9048, 4);
      expect(result.tick).toBe(tick);
    });

    it('supports round trips with base quote', () => {
      const tokenBase = createToken('0x100', 6);
      const tokenQuote = createToken('0x200', 6);
      const price = 5.0;

      const priceResult = TickUtils.getAlignedPrice(price, tokenBase, tokenQuote, 1n, true);
      const tickResult = TickUtils.getPriceFromTick(priceResult.tick, tokenBase, tokenQuote, true);

      expect(tickResult.price).toBeCloseTo(priceResult.price, 2);
    });
  });
});
