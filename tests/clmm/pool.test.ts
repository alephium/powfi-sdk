import { PoolUtils } from '../../src/clmm/pool';
import { TickUtils } from '../../src/clmm/tick';
import { ClmmLiquidityUtils } from '../../src/clmm/liquidity';
import type { LiquidityDistribution } from '../../src/clmm/types';

describe('PoolUtils', () => {
  it('computeSwapStep exact-in zeroForOne reaches target price', () => {
    const sqrtStart = TickUtils.getSqrtRatioAtTick(0n);
    const sqrtTarget = TickUtils.getSqrtRatioAtTick(100n);
    const liquidity = 1_000_000n;
    const amountRequired = -ClmmLiquidityUtils.getAmountDelta(
      sqrtStart,
      sqrtTarget,
      -liquidity,
      true,
    );

    const [nextPrice, amountIn, amountOut] = PoolUtils.computeSwapStep(
      sqrtStart,
      sqrtTarget,
      liquidity,
      amountRequired,
      0n,
    );

    const expectedAmountOut = ClmmLiquidityUtils.getAmountDelta(
      sqrtTarget,
      sqrtStart,
      liquidity,
      true,
    );

    expect(nextPrice).toBe(sqrtTarget);
    expect(amountIn).toBe(amountRequired);
    expect(amountOut).toBe(expectedAmountOut);
  });

  it('computeSwapStep exact-in zeroForOne with partial fill stops early', () => {
    const sqrtStart = TickUtils.getSqrtRatioAtTick(0n);
    const sqrtTarget = TickUtils.getSqrtRatioAtTick(100n);
    const liquidity = 1_000_000n;
    const limitedAmount = 1000n;

    const [nextPrice, amountIn, amountOut, feeAmount] = PoolUtils.computeSwapStep(
      sqrtStart,
      sqrtTarget,
      liquidity,
      limitedAmount,
      0n,
    );

    const expectedNextPrice = TickUtils.getNextSqrtPrice(sqrtStart, liquidity, limitedAmount, true);
    const expectedAmountOut = ClmmLiquidityUtils.getAmountDelta(
      expectedNextPrice,
      sqrtStart,
      liquidity,
      true,
    );

    expect(nextPrice).toBe(expectedNextPrice);
    expect(amountIn + feeAmount).toBe(limitedAmount);
    expect(amountOut).toBe(expectedAmountOut);
  });

  it('computeSwapStep exact-in zeroForOne=false reaches target', () => {
    const sqrtStart = TickUtils.getSqrtRatioAtTick(100n);
    const sqrtTarget = TickUtils.getSqrtRatioAtTick(0n);
    const liquidity = 1_000_000n;
    const amountRequired = -ClmmLiquidityUtils.getAmountDelta(
      sqrtStart,
      sqrtTarget,
      -liquidity,
      false,
    );

    const [nextPrice, amountIn, amountOut, feeAmount] = PoolUtils.computeSwapStep(
      sqrtStart,
      sqrtTarget,
      liquidity,
      amountRequired,
      0n,
    );

    const expectedAmountOut = ClmmLiquidityUtils.getAmountDelta(
      sqrtTarget,
      sqrtStart,
      liquidity,
      false,
    );

    expect(nextPrice).toBe(sqrtTarget);
    expect(amountIn).toBe(amountRequired);
    expect(amountOut).toBe(expectedAmountOut);
    expect(feeAmount).toBe(0n);
  });

  it('offlineSwap aggregates computeSwapStep results across rows', () => {
    const sqrtStart = TickUtils.getSqrtRatioAtTick(0n);
    const sqrtMid = TickUtils.getSqrtRatioAtTick(50n);
    const sqrtEnd = TickUtils.getSqrtRatioAtTick(100n);
    const liquidity = 500_000n;
    const fee = 0n;
    const amountSpecified = 2_000n;

    const distribution: LiquidityDistribution = {
      baseSqrtPriceX96: sqrtStart,
      sqrtPriceX96: sqrtStart,
      liquidity,
      fee,
      rows: [
        { liquidity, sqrtPriceX96: sqrtMid },
        { liquidity, sqrtPriceX96: sqrtEnd },
      ],
    };

    const offlineAmount = PoolUtils.offlineSwap(distribution, amountSpecified, sqrtStart);

    let remainingAmount = amountSpecified;
    let runningPrice = sqrtStart;
    let expectedAmount = 0n;
    for (const row of distribution.rows) {
      const [nextPrice, amountIn, amountOut, feeAmount] = PoolUtils.computeSwapStep(
        runningPrice,
        row.sqrtPriceX96,
        liquidity,
        remainingAmount,
        fee,
      );
      remainingAmount -= amountIn + feeAmount;
      expectedAmount -= amountOut;
      runningPrice = nextPrice;
    }

    expect(offlineAmount).toBe(expectedAmount);
  });
});
