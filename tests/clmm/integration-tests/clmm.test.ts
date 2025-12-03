import type { SignerProvider } from '@alephium/web3';
import { ONE_ALPH, web3 } from '@alephium/web3';
import { getSigners } from '@alephium/web3-test';
import { ClmmLiquidityUtils } from '../../../src/clmm/liquidity';
import { TickUtils } from '../../../src/clmm/tick';
import { UNLIMITED_AMOUNT } from '../../../src';
import { assertBalancesChange, Fixture } from './helpers';

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch);

describe('CLMM Module', () => {
  let fixture: Fixture;
  let lp: SignerProvider;
  let trader: SignerProvider;

  beforeEach(async () => {
    fixture = await Fixture.create();
    const signers = await getSigners(2, 3_000n * ONE_ALPH);
    lp = signers[0];
    trader = signers[1];
    await fixture.transferToken(fixture.tokenId0, 2000n * ONE_ALPH, lp);
    await fixture.transferToken(fixture.tokenId1, 2000n * ONE_ALPH, lp);
    await fixture.transferToken(fixture.tokenId0, 1000n * ONE_ALPH, trader);
    await fixture.transferToken(fixture.tokenId1, 1000n * ONE_ALPH, trader);
  });

  test('Add liquidity and swap', async () => {
    const tickSpacing = 1n;
    const fee = 3_000n;
    const feeProtocol = 0n;
    const configIndex = await fixture.createConfigIndex(tickSpacing, fee, feeProtocol);
    const pool = await fixture.createPoolWithInitialLiquidity(
      configIndex,
      100n * ONE_ALPH,
      1000n * ONE_ALPH,
    );
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, tickSpacing, 0.9, 1.1);

    const [token0Amount, token1Amount, liquidity] = ClmmLiquidityUtils.getPositionAmountsFromPrice(
      sqrtPriceCurrent,
      fixture.tokenId0,
      fixture.tokenId1,
      tickLower,
      tickUpper,
      100n * ONE_ALPH,
      UNLIMITED_AMOUNT,
    );

    const tokenIds = [fixture.tokenId0, fixture.tokenId1];
    const liquiditySlippage = 30n; // allow +/- 30 ticks around the current tick
    await assertBalancesChange({
      pool,
      signer: lp,
      tokenIds,
      action: () =>
        fixture.addLiquidity(
          lp,
          configIndex,
          token0Amount,
          token1Amount,
          liquiditySlippage,
          tickLower,
          tickUpper,
        ),
      expect: {
        signer: {
          [fixture.tokenId0]: -token0Amount,
          [fixture.tokenId1]: -token1Amount,
        },
        pool: {
          [fixture.tokenId0]: token0Amount,
          [fixture.tokenId1]: token1Amount,
        },
        poolLiquidityDelta: liquidity,
      },
    });

    const swapIn = 5n * ONE_ALPH;
    const expectedOutput = await fixture.computeSwapBaseIn(
      configIndex,
      fixture.tokenId0,
      fixture.tokenId1,
      swapIn,
    );

    const swapSlippage = 30;
    await assertBalancesChange({
      pool,
      signer: trader,
      tokenIds,
      action: () => fixture.swapExactIn(trader, configIndex, swapIn, swapSlippage),
      expect: {
        signer: {
          [fixture.tokenId0]: -swapIn,
          [fixture.tokenId1]: expectedOutput - 1n,
        },
        pool: {
          [fixture.tokenId0]: swapIn,
          [fixture.tokenId1]: -expectedOutput + 1n,
        },
        poolLiquidityDelta: 0n,
      },
    });
  }, 60000);

  test('Add liquidity with current price below range (position fully in token1)', async () => {
    const tickSpacing = 1n;
    const fee = 3_000n;
    const feeProtocol = 0n;
    const configIndex = await fixture.createConfigIndex(tickSpacing, fee, feeProtocol);
    const pool = await fixture.createPoolWithInitialLiquidity(
      configIndex,
      100n * ONE_ALPH,
      1000n * ONE_ALPH,
    );
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;
    const tokenIds = [fixture.tokenId0, fixture.tokenId1];

    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, tickSpacing, 0.8, 0.9);
    const sqrtLower = TickUtils.getSqrtRatioAtTick(tickLower);
    const sqrtUpper = TickUtils.getSqrtRatioAtTick(tickUpper);

    const _token1Amount = 100n * ONE_ALPH;
    const [token0Amount, token1Amount, liquidity] = ClmmLiquidityUtils.getPositionAmountsFromPrice(
      sqrtPriceCurrent,
      fixture.tokenId0,
      fixture.tokenId1,
      tickLower,
      tickUpper,
      UNLIMITED_AMOUNT,
      _token1Amount,
    );

    expect(token0Amount).toBe(0n);
    expect(token1Amount).toBe(_token1Amount);
    expect(ClmmLiquidityUtils.getLiquidityFromToken1(sqrtLower, sqrtUpper, _token1Amount)).toBe(
      liquidity,
    );

    await assertBalancesChange({
      pool,
      signer: lp,
      tokenIds,
      action: () =>
        fixture.addLiquidity(
          lp,
          configIndex,
          token0Amount,
          token1Amount,
          30n,
          tickLower,
          tickUpper,
        ),
      expect: {
        signer: {
          [fixture.tokenId0]: -token0Amount,
          [fixture.tokenId1]: -token1Amount,
        },
        pool: {
          [fixture.tokenId0]: token0Amount,
          [fixture.tokenId1]: token1Amount,
        },
        poolLiquidityDelta: 0n,
      },
    });
  }, 30000);

  test('Add liquidity with current price above range (position fully in token0)', async () => {
    const tickSpacing = 1n;
    const fee = 3_000n;
    const feeProtocol = 0n;
    const configIndex = await fixture.createConfigIndex(tickSpacing, fee, feeProtocol);
    const pool = await fixture.createPoolWithInitialLiquidity(
      configIndex,
      100n * ONE_ALPH,
      1000n * ONE_ALPH,
    );
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;
    const tokenIds = [fixture.tokenId0, fixture.tokenId1];

    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, tickSpacing, 1.1, 1.2);
    const sqrtLower = TickUtils.getSqrtRatioAtTick(tickLower);
    const sqrtUpper = TickUtils.getSqrtRatioAtTick(tickUpper);

    const _token0Amount = 100n * ONE_ALPH;
    const [token0Amount, token1Amount, liquidity] = ClmmLiquidityUtils.getPositionAmountsFromPrice(
      sqrtPriceCurrent,
      fixture.tokenId0,
      fixture.tokenId1,
      tickLower,
      tickUpper,
      _token0Amount,
      UNLIMITED_AMOUNT,
    );

    expect(token0Amount).toBe(_token0Amount);
    expect(token1Amount).toBe(0n);
    expect(ClmmLiquidityUtils.getLiquidityFromToken0(sqrtLower, sqrtUpper, _token0Amount)).toBe(
      liquidity,
    );

    await assertBalancesChange({
      pool,
      signer: lp,
      tokenIds,
      action: () =>
        fixture.addLiquidity(
          lp,
          configIndex,
          token0Amount,
          token1Amount,
          30n,
          tickLower,
          tickUpper,
        ),
      expect: {
        signer: {
          [fixture.tokenId0]: -token0Amount,
          [fixture.tokenId1]: -token1Amount,
        },
        pool: {
          [fixture.tokenId0]: token0Amount,
          [fixture.tokenId1]: token1Amount,
        },
        poolLiquidityDelta: 0n,
      },
    });
  }, 30000);
});
