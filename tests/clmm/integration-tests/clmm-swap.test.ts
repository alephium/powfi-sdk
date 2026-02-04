import type { SignerProvider } from '@alephium/web3';
import { ONE_ALPH, web3 } from '@alephium/web3';
import { getSigners } from '@alephium/web3-test';
import { UNLIMITED_AMOUNT } from '../../../src';
import { assertBalancesChange, Fixture, getBalances } from './helpers';

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch);

describe('CLMM Swap', () => {
  let fixture: Fixture;
  let lp: SignerProvider;
  let trader: SignerProvider;
  const tickSpacing = 1n;
  const fee = 3_000n;
  const feeProtocol = 0n;

  beforeEach(async () => {
    fixture = await Fixture.create();
    const signers = await getSigners(2, 3_000n * ONE_ALPH);
    lp = signers[0];
    trader = signers[1];
    await fixture.transferToken(fixture.tokenId0, 2_000n * ONE_ALPH, lp);
    await fixture.transferToken(fixture.tokenId1, 2_000n * ONE_ALPH, lp);
    await fixture.transferToken(fixture.tokenId0, 1_000n * ONE_ALPH, trader);
    await fixture.transferToken(fixture.tokenId1, 1_000n * ONE_ALPH, trader);
  });

  const setupPoolWithLiquidity = async () => {
    const { configIndex, pool } = await fixture.setupPool(tickSpacing, fee, feeProtocol);
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

    const poolStateAfter = await pool.fetchState();
    const liquidity = poolStateAfter.fields.liquidity;

    return { configIndex, pool, tokenIds: [fixture.tokenId0, fixture.tokenId1], liquidity };
  };

  test('exact-in swap', async () => {
    const { configIndex, pool, tokenIds } = await setupPoolWithLiquidity();

    const swapIn = 5n * ONE_ALPH;
    const expectedOutput = await fixture.computeSwapBaseIn(
      configIndex,
      fixture.tokenId0,
      fixture.tokenId1,
      swapIn,
    );

    await assertBalancesChange({
      pool,
      signer: trader,
      tokenIds,
      action: () => fixture.swap(trader, configIndex, swapIn, 30),
      expect: {
        signer: {
          [fixture.tokenId0]: -swapIn,
          [fixture.tokenId1]: -expectedOutput,
        },
        pool: {
          [fixture.tokenId0]: swapIn,
          [fixture.tokenId1]: expectedOutput,
        },
        poolLiquidityDelta: 0n,
      },
    });
  }, 60000);

  test('exact-out swap', async () => {
    const { configIndex, pool, tokenIds } = await setupPoolWithLiquidity();
    const traderAddr = (await trader.getSelectedAccount()).address;
    const beforeTrader = await getBalances(traderAddr, tokenIds);
    const beforePool = await getBalances(pool.address, tokenIds);

    const exactOut = 5n * ONE_ALPH;
    const expectedInput = await fixture.computeSwapBaseOut(
      configIndex,
      fixture.tokenId0,
      fixture.tokenId1,
      exactOut,
    );

    await fixture.swap(trader, configIndex, exactOut, 30, {
      token0: fixture.tokenId1,
      token1: fixture.tokenId0,
    });

    const afterTrader = await getBalances(traderAddr, tokenIds);
    const afterPool = await getBalances(pool.address, tokenIds);

    const traderToken0Delta =
      afterTrader.tokens[fixture.tokenId0] - beforeTrader.tokens[fixture.tokenId0];
    const traderToken1Delta =
      afterTrader.tokens[fixture.tokenId1] - beforeTrader.tokens[fixture.tokenId1];
    const poolToken0Delta =
      afterPool.tokens[fixture.tokenId0] - beforePool.tokens[fixture.tokenId0];
    const poolToken1Delta =
      afterPool.tokens[fixture.tokenId1] - beforePool.tokens[fixture.tokenId1];

    expect(traderToken0Delta).toBeLessThanOrEqual(expectedInput);
    expect(traderToken1Delta).toBe(-exactOut);
    expect(-poolToken0Delta).toBeLessThanOrEqual(expectedInput);
    expect(poolToken1Delta).toBe(exactOut);
  }, 60000);

  test('slippage limit enforcement rejects swap', async () => {
    const { configIndex } = await setupPoolWithLiquidity();
    const amountIn = 500n * ONE_ALPH;
    await expect(fixture.swap(trader, configIndex, amountIn, 0)).rejects.toThrow();
  }, 30000);
});
