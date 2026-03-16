import type { SignerProvider } from '@alephium/web3';
import { ONE_ALPH, web3 } from '@alephium/web3';
import { getSigners, getSigner } from '@alephium/web3-test';
import { ClmmLiquidityUtils } from '../../../src/clmm/liquidity';
import { TickUtils } from '../../../src/clmm/tick';
import { UNLIMITED_AMOUNT } from '../../../src';
import { Fixture, getBalances } from './helpers';

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch);

describe('CLMM Remove Liquidity', () => {
  let fixture: Fixture;
  let lp: SignerProvider;

  beforeEach(async () => {
    fixture = await Fixture.create();
    const signers = await getSigners(1, 3_000n * ONE_ALPH);
    lp = signers[0];
    await fixture.transferToken(fixture.tokenId0, 5_000n * ONE_ALPH, lp);
    await fixture.transferToken(fixture.tokenId1, 5_000n * ONE_ALPH, lp);
  });

  test('partial removal of active position', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolState = await pool.fetchState();
    const sqrtPriceCurrent = poolState.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1);

    const { liquidity } = await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: { tickLower, tickUpper },
      amount0Desired: 200n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT,
    });

    const removeLiq = liquidity / 2n;
    const [amt0Out, amt1Out] = ClmmLiquidityUtils.getAmountsForLiquidity(
      sqrtPriceCurrent,
      TickUtils.getSqrtRatioAtTick(tickLower),
      TickUtils.getSqrtRatioAtTick(tickUpper),
      removeLiq,
    );

    const tokenIds = [fixture.tokenId0, fixture.tokenId1];
    const lpAddr = (await lp.getSelectedAccount()).address;
    const beforeLp = await getBalances(lpAddr, tokenIds);
    const beforePool = await getBalances(pool.address, tokenIds);
    const beforeState = await pool.fetchState();

    await fixture.removeLiquidity(
      lp,
      configIndex,
      removeLiq,
      tickLower,
      tickUpper,
      amt0Out,
      amt1Out,
    );

    await fixture.collectTokens(lp, configIndex, tickLower, tickUpper, amt0Out, amt1Out);

    const afterLp = await getBalances(lpAddr, tokenIds);
    const afterPool = await getBalances(pool.address, tokenIds);
    const afterState = await pool.fetchState();

    expect(afterLp.tokens[fixture.tokenId0] - beforeLp.tokens[fixture.tokenId0]).toBe(amt0Out);
    expect(afterLp.tokens[fixture.tokenId1] - beforeLp.tokens[fixture.tokenId1]).toBe(amt1Out);
    expect(afterPool.tokens[fixture.tokenId0] - beforePool.tokens[fixture.tokenId0]).toBe(-amt0Out);
    expect(afterPool.tokens[fixture.tokenId1] - beforePool.tokens[fixture.tokenId1]).toBe(-amt1Out);
    expect(afterState.fields.liquidity - beforeState.fields.liquidity).toBe(-removeLiq);
  });

  test('full removal of active position', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolState = await pool.fetchState();
    const sqrtPriceCurrent = poolState.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1);

    const { liquidity } = await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: { tickLower, tickUpper },
      amount0Desired: 150n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT,
    });

    const [amt0Out, amt1Out] = ClmmLiquidityUtils.getAmountsForLiquidity(
      sqrtPriceCurrent,
      TickUtils.getSqrtRatioAtTick(tickLower),
      TickUtils.getSqrtRatioAtTick(tickUpper),
      liquidity,
    );

    const tokenIds = [fixture.tokenId0, fixture.tokenId1];
    const lpAddr = (await lp.getSelectedAccount()).address;
    const beforeLp = await getBalances(lpAddr, tokenIds);
    const beforePool = await getBalances(pool.address, tokenIds);
    const beforeState = await pool.fetchState();

    await fixture.removeLiquidity(
      lp,
      configIndex,
      liquidity,
      tickLower,
      tickUpper,
      amt0Out,
      amt1Out,
    );
    expect(fixture.collectTokens(lp, configIndex, tickLower, tickUpper, amt0Out, amt1Out)).rejects.toThrow('expected: 1, got: 0')

    const afterLp = await getBalances(lpAddr, tokenIds);
    const afterPool = await getBalances(pool.address, tokenIds);
    const afterState = await pool.fetchState();

    expect(afterLp.tokens[fixture.tokenId0] - beforeLp.tokens[fixture.tokenId0]).toBe(amt0Out);
    expect(afterLp.tokens[fixture.tokenId1] - beforeLp.tokens[fixture.tokenId1]).toBe(amt1Out);
    expect(afterPool.tokens[fixture.tokenId0] - beforePool.tokens[fixture.tokenId0]).toBe(-amt0Out);
    expect(afterPool.tokens[fixture.tokenId1] - beforePool.tokens[fixture.tokenId1]).toBe(-amt1Out);
    expect(afterState.fields.liquidity - beforeState.fields.liquidity).toBe(-liquidity);
  });

  test('removing inactive position does not change active liquidity', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolState = await pool.fetchState();
    const sqrtPriceCurrent = poolState.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 1.1, 1.2);

    const { liquidity } = await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: { tickLower, tickUpper },
      amount0Desired: 100n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT,
    });

    const sqrtLower = TickUtils.getSqrtRatioAtTick(tickLower);
    const sqrtUpper = TickUtils.getSqrtRatioAtTick(tickUpper);
    const [amt0Out, amt1Out] = ClmmLiquidityUtils.getAmountsForLiquidity(
      sqrtPriceCurrent,
      sqrtLower,
      sqrtUpper,
      liquidity,
    );

    const tokenIds = [fixture.tokenId0, fixture.tokenId1];
    const lpAddr = (await lp.getSelectedAccount()).address;
    const beforeLp = await getBalances(lpAddr, tokenIds);
    const beforePool = await getBalances(pool.address, tokenIds);
    const beforeState = await pool.fetchState();

    await fixture.collectTokens(
      lp,
      configIndex,
      tickLower,
      tickUpper,
      UNLIMITED_AMOUNT,
      UNLIMITED_AMOUNT,
      liquidity,
    );

    const afterLp = await getBalances(lpAddr, tokenIds);
    const afterPool = await getBalances(pool.address, tokenIds);
    const afterState = await pool.fetchState();

    expect(afterLp.tokens[fixture.tokenId0] - beforeLp.tokens[fixture.tokenId0]).toBe(amt0Out);
    expect(afterLp.tokens[fixture.tokenId1] - beforeLp.tokens[fixture.tokenId1]).toBe(amt1Out);
    expect(afterPool.tokens[fixture.tokenId0] - beforePool.tokens[fixture.tokenId0]).toBe(-amt0Out);
    expect(afterPool.tokens[fixture.tokenId1] - beforePool.tokens[fixture.tokenId1]).toBe(-amt1Out);
    expect(afterState.fields.liquidity - beforeState.fields.liquidity).toBe(0n);
  });

  test('remove liquidity and add liquidity to existing position works for groupless address with non-zero default group', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolState = await pool.fetchState();
    const sqrtPriceCurrent = poolState.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1);

    const grouplessLp = await getSigner(3_000n * ONE_ALPH, 1, 'gl-secp256k1');
    await fixture.transferToken(fixture.tokenId0, 500n * ONE_ALPH, grouplessLp);
    await fixture.transferToken(fixture.tokenId1, 500n * ONE_ALPH, grouplessLp);

    const { liquidity } = await fixture.addRangePosition({
      lp: grouplessLp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: { tickLower, tickUpper },
      amount0Desired: 10n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT,
    });

    const removeLiq = liquidity / 2n;
    const [amt0Out, amt1Out] = ClmmLiquidityUtils.getAmountsForLiquidity(
      sqrtPriceCurrent,
      TickUtils.getSqrtRatioAtTick(tickLower),
      TickUtils.getSqrtRatioAtTick(tickUpper),
      removeLiq,
    );

    const tokenIds = [fixture.tokenId0, fixture.tokenId1];
    const lpAddr = (await grouplessLp.getSelectedAccount()).address;
    const beforeLp = await getBalances(lpAddr, tokenIds);
    const beforePool = await getBalances(pool.address, tokenIds);
    const beforeState = await pool.fetchState();

    await fixture.removeLiquidity(
      grouplessLp,
      configIndex,
      removeLiq,
      tickLower,
      tickUpper,
      amt0Out,
      amt1Out,
    );

    await fixture.collectTokens(grouplessLp, configIndex, tickLower, tickUpper, amt0Out, amt1Out);

    const afterLp = await getBalances(lpAddr, tokenIds);
    const afterPool = await getBalances(pool.address, tokenIds);
    const afterState = await pool.fetchState();

    expect(afterLp.tokens[fixture.tokenId0] - beforeLp.tokens[fixture.tokenId0]).toBe(amt0Out);
    expect(afterLp.tokens[fixture.tokenId1] - beforeLp.tokens[fixture.tokenId1]).toBe(amt1Out);
    expect(afterPool.tokens[fixture.tokenId0] - beforePool.tokens[fixture.tokenId0]).toBe(-amt0Out);
    expect(afterPool.tokens[fixture.tokenId1] - beforePool.tokens[fixture.tokenId1]).toBe(-amt1Out);
    expect(afterState.fields.liquidity - beforeState.fields.liquidity).toBe(-removeLiq);

    // Add liquidity back to the same position
    const { liquidity: addedLiquidity } = await fixture.addRangePosition({
      lp: grouplessLp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: { tickLower, tickUpper },
      amount0Desired: 5n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT,
      existingPosition: true,
    });

    const finalState = await pool.fetchState();
    expect(finalState.fields.liquidity - afterState.fields.liquidity).toBe(addedLiquidity);
  });
});
