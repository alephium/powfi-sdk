import { PoolUtils } from '../../src/clmm/pool';
import { TickUtils } from '../../src/clmm/tick';
import { ClmmLiquidityUtils } from '../../src/clmm/liquidity';
import type { LiquidityDistribution } from '../../src/clmm/types';

describe('PoolUtils', () => {
  it('computeSwapStep exact-in zeroForOne reaches target price', () => {
    const sqrtStart = TickUtils.getSqrtRatioAtTick(0n);
    const sqrtTarget = TickUtils.getSqrtRatioAtTick(-100n);
    const zeroForOne = sqrtStart >= sqrtTarget;
    const liquidity = 1_000_000n;
    const amountRequired = -ClmmLiquidityUtils.getAmountDelta(
      sqrtTarget,
      sqrtStart,
      -liquidity,
      zeroForOne,
    );

    const [nextPrice, amountIn, amountOut] = PoolUtils.computeSwapStep(
      sqrtStart,
      sqrtTarget,
      liquidity,
      amountRequired,
      0n,
    );

    const expectedAmountOut = ClmmLiquidityUtils.getToken1Delta(
      sqrtTarget,
      sqrtStart,
      liquidity,
    );

    expect(amountIn).toBe(amountRequired);
    expect(amountOut).toBe(expectedAmountOut);
    expect(nextPrice).toBe(sqrtTarget);
  });

  it('computeSwapStep exact-in zeroForOne with partial fill stops early', () => {
    const sqrtStart = TickUtils.getSqrtRatioAtTick(0n);
    const sqrtTarget = TickUtils.getSqrtRatioAtTick(-100n);
    const zeroForOne = sqrtStart >= sqrtTarget;
    const liquidity = 1_000_000n;
    const limitedAmount = 1000n;

    const [nextPrice, amountIn, amountOut, feeAmount] = PoolUtils.computeSwapStep(
      sqrtStart,
      sqrtTarget,
      liquidity,
      limitedAmount,
      0n,
    );

    const expectedNextPrice = TickUtils.getNextSqrtPriceFromAmount0(sqrtStart, liquidity, limitedAmount);
    const expectedAmountOut = ClmmLiquidityUtils.getToken1Delta(
      expectedNextPrice,
      sqrtStart,
      liquidity,
    );

    expect(nextPrice).toBe(expectedNextPrice);
    expect(amountIn + feeAmount).toBe(limitedAmount);
    expect(amountOut).toBe(expectedAmountOut);
  });

  it('computeSwapStep exact-in zeroForOne=false reaches target', () => {
    const sqrtStart = TickUtils.getSqrtRatioAtTick(-100n);
    const sqrtTarget = TickUtils.getSqrtRatioAtTick(0n);
    const zeroForOne = sqrtStart >= sqrtTarget;
    const liquidity = 1_000_000n;
    const amountRequired = -ClmmLiquidityUtils.getAmountDelta(
      sqrtTarget,
      sqrtStart,
      -liquidity,
      zeroForOne,
    );

    const [nextPrice, amountIn, amountOut, feeAmount] = PoolUtils.computeSwapStep(
      sqrtStart,
      sqrtTarget,
      liquidity,
      amountRequired,
      0n,
    );

    const expectedAmountOut = ClmmLiquidityUtils.getToken0Delta(
      sqrtStart,
      sqrtTarget,
      liquidity,
    );

    expect(nextPrice).toBe(sqrtTarget);
    expect(amountIn).toBe(amountRequired);
    expect(amountOut).toBe(expectedAmountOut);
  });

  it('offlineSwap aggregates computeSwapStep results across rows', () => {
    const baseSqrtPriceX96 = 25359128950929096498230469618n;
    const sqrtStart = 25054144837504793118641380156n;
    const sqrtMid = 25037868506736684196722767383n;
    const sqrtEnd = 24812204317571784030572443243n;
    const liquidity = 3162n;
    const fee = 3000n;
    const amountSpecified = 100n;

    const distribution: LiquidityDistribution = {
      baseSqrtPriceX96,
      fee,
      liquidity,
      rows : [
        {sqrtPriceX96: sqrtMid, liquidity},
        {sqrtPriceX96: sqrtEnd, liquidity}
      ],
      sqrtPriceX96: sqrtStart
    };

    const offlineAmount = PoolUtils.offlineSwap(distribution, amountSpecified, sqrtStart);
    const amountSpecified2 = PoolUtils.offlineSwap(distribution, offlineAmount, sqrtStart);

    let remainingAmount = amountSpecified;
    let runningPrice = sqrtStart;
    let expectedAmount = 0n;
    for (const row of distribution.rows) {
      const [nextPrice, amountIn, amountOut, feeAmount] = PoolUtils.computeSwapStep(
        runningPrice,
        row.sqrtPriceX96,
        row.liquidity,
        remainingAmount,
        fee,
      );
      remainingAmount -= amountIn + feeAmount;
      expectedAmount -= amountOut;
      runningPrice = nextPrice;
    }

    expect(offlineAmount).toBe(expectedAmount);
    expect(amountSpecified2).toBe(amountSpecified);
  });

  it('offlineSwap aggregates computeSwapStep results across rows - exact out', () => {
    const sqrtStart = 25054144837504793118641380156n;
    const baseSqrtPriceX96 = 25037868506736684196722767383n;
    const liquidity = 3162n;
    const fee = 3000n;

    const liqDist2: LiquidityDistribution = {
      sqrtPriceX96: sqrtStart,
      baseSqrtPriceX96,
      liquidity,
      fee,
      rows: [
        { sqrtPriceX96: 25279651941435336774030973942n, liquidity }
      ]
    };

    const amountSpecified = 10n;
    const offlineAmount = PoolUtils.offlineSwap(liqDist2, amountSpecified, sqrtStart);
    const amountSpecified2 = PoolUtils.offlineSwap(liqDist2, offlineAmount, sqrtStart);

    let remainingAmount = amountSpecified;
    let runningPrice = sqrtStart;
    let expectedAmount = 0n;
    for (const row of liqDist2.rows) {
      const [nextPrice, amountIn, amountOut, feeAmount] = PoolUtils.computeSwapStep(
        runningPrice,
        row.sqrtPriceX96,
        row.liquidity,
        remainingAmount,
        fee,
      );
      remainingAmount -= amountIn + feeAmount;
      expectedAmount -= amountOut;
      runningPrice = nextPrice;
    }

    expect(offlineAmount).toBe(expectedAmount);
    expect(amountSpecified2).toBe(amountSpecified);
  });
});
