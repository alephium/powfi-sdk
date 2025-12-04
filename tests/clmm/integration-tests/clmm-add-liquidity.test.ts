import type { SignerProvider } from '@alephium/web3';
import { ONE_ALPH, web3 } from '@alephium/web3';
import { getSigners } from '@alephium/web3-test';
import { ClmmLiquidityUtils } from '../../../src/clmm/liquidity';
import { TickUtils } from '../../../src/clmm/tick';
import { UNLIMITED_AMOUNT } from '../../../src';
import { Fixture } from './helpers';

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch);

describe('CLMM Add Liquidity', () => {
  let fixture: Fixture;
  let lp: SignerProvider;

  beforeEach(async () => {
    fixture = await Fixture.create();
    const signers = await getSigners(2, 3_000n * ONE_ALPH);
    lp = signers[0];
    await fixture.transferToken(fixture.tokenId0, 2_000n * ONE_ALPH, lp);
    await fixture.transferToken(fixture.tokenId1, 2_000n * ONE_ALPH, lp);
  });

  test('current price inside range (token0 and token1 provided)', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1);

    await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: { tickLower, tickUpper },
      amount0Desired: 100n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT,
    });
  });

  test('current price above provided range (position fully in token1)', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.8, 0.9);
    const sqrtLower = TickUtils.getSqrtRatioAtTick(tickLower);
    const sqrtUpper = TickUtils.getSqrtRatioAtTick(tickUpper);

    const token1Desired = 100n * ONE_ALPH;
    const {
      amount0: token0Amount,
      amount1: token1Amount,
      liquidity,
    } = await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: { tickLower, tickUpper },
      amount0Desired: UNLIMITED_AMOUNT,
      amount1Desired: token1Desired,
    });

    expect(token0Amount).toBe(0n);
    expect(token1Amount).toBe(token1Desired);
    expect(ClmmLiquidityUtils.getLiquidityFromToken1(sqrtLower, sqrtUpper, token1Desired)).toBe(
      liquidity,
    );
  });

  test('current price below provided range (position fully in token0)', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 1.1, 1.2);
    const sqrtLower = TickUtils.getSqrtRatioAtTick(tickLower);
    const sqrtUpper = TickUtils.getSqrtRatioAtTick(tickUpper);

    const token0Desired = 100n * ONE_ALPH;
    const {
      amount0: token0Amount,
      amount1: token1Amount,
      liquidity,
    } = await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: { tickLower, tickUpper },
      amount0Desired: token0Desired,
      amount1Desired: UNLIMITED_AMOUNT,
    });

    expect(token0Amount).toBe(token0Desired);
    expect(token1Amount).toBe(0n);
    expect(ClmmLiquidityUtils.getLiquidityFromToken0(sqrtLower, sqrtUpper, token0Desired)).toBe(
      liquidity,
    );
  });

  test('partially overlapping positions both add liquidity', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;

    await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: fixture.buildRange(sqrtPriceCurrent, 1n, 0.85, 1.05),
      amount0Desired: 40n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT,
    });

    await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: fixture.buildRange(sqrtPriceCurrent, 1n, 0.95, 1.15),
      amount0Desired: 60n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT,
    });
  });

  test('nested positions (first contains second) both add liquidity', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;

    await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1),
      amount0Desired: 50n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT,
    });

    await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: fixture.buildRange(sqrtPriceCurrent, 1n, 0.95, 1.05),
      amount0Desired: 25n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT,
    });
  });

  test('nested positions (second contains first) both add liquidity', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;

    await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: fixture.buildRange(sqrtPriceCurrent, 1n, 0.95, 1.05),
      amount0Desired: 30n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT,
    });
    await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: fixture.buildRange(sqrtPriceCurrent, 1n, 0.85, 1.15),
      amount0Desired: 70n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT,
    });
  });

  test('fails when LP lacks sufficient tokens for provided range', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1);

    // Intentionally request more than funded balance
    const hugeAmount = 10_000n * ONE_ALPH;
    await expect(
      fixture.addLiquidity(lp, configIndex, hugeAmount, hugeAmount, 30n, tickLower, tickUpper),
    ).rejects.toThrow();
  });
});
