import type { SignerProvider } from '@alephium/web3';
import {
  ONE_ALPH,
  web3,
  ALPH_TOKEN_ID,
  MINIMAL_CONTRACT_DEPOSIT,
  NodeProvider,
  addressFromContractId,
} from '@alephium/web3';
import { getSigners } from '@alephium/web3-test';
import { ClmmLiquidityUtils } from '../../../src/clmm/liquidity';
import { TickUtils } from '../../../src/clmm/tick';
import { UNLIMITED_AMOUNT } from '../../../src';
import { Powfi } from '../../../src/powfi';
import { Fixture } from './helpers';
import { PrivateKeyWallet } from '@alephium/web3-wallet';
import { Position } from 'clmm';

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch);

describe('CLMM Add Liquidity', () => {
  let fixture: Fixture;
  let lp: SignerProvider;
  let lp2: SignerProvider;

  beforeEach(async () => {
    fixture = await Fixture.create();
    const signers = await getSigners(2, 3_000n * ONE_ALPH);
    lp = signers[0];
    lp2 = signers[1];
    await fixture.transferToken(fixture.tokenId0, 2_000n * ONE_ALPH, lp);
    await fixture.transferToken(fixture.tokenId1, 2_000n * ONE_ALPH, lp);
    await fixture.transferToken(fixture.tokenId0, 2_000n * ONE_ALPH, lp2);
    await fixture.transferToken(fixture.tokenId1, 2_000n * ONE_ALPH, lp2);
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

  test('add liquidity succeeds for a fresh ALPH/token position', async () => {
    const configIndex = await fixture.createConfigIndex(1n, 3_000n, 0n);
    const token0 = ALPH_TOKEN_ID;
    const token1 = fixture.tokenId0;
    const currentTick = TickUtils.getAlignedTick(10, 18, 18, 1n);

    await fixture.factory.transact.create({
      signer: fixture.deployer,
      args: {
        token0,
        token1,
        configIndex,
        sqrtPriceX96: TickUtils.getSqrtRatioAtTick(currentTick),
        rewardToken: '',
      },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT,
    });

    const pool = fixture.powfi.clmm.getPool(token0, token1, configIndex);
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1);
    const { newAmountBase: amount0, newAmountQuote: amount1 } =
      ClmmLiquidityUtils.getPositionAmountsFromPrice({
        sqrtRatioX96: sqrtPriceCurrent,
        tokenBaseId: token0,
        tokenQuoteId: token1,
        lowerTick: tickLower,
        upperTick: tickUpper,
        amountBase: 10n * ONE_ALPH,
        amountQuote: 100n * ONE_ALPH,
      });
    const balancesBefore = await fixture.powfi.clmm.getPoolTokenBalances(pool.contractId);
    const lpAddress = (await lp.getSelectedAccount()).address;

    fixture.powfi.signer = lp;
    const { positionId } = await fixture.powfi.clmm.addLiquidity({
      token0,
      token1,
      configIndex,
      owner: lpAddress,
      tickLower,
      tickUpper,
      slippage: 30n,
      amount0,
      amount1,
      existingPosition: false,
    });

    const balancesAfter = await fixture.powfi.clmm.getPoolTokenBalances(pool.contractId);
    const positionAddress = addressFromContractId(positionId);
    const positionState = await Position.at(positionAddress).fetchState();

    expect(balancesAfter.token0Balance - balancesBefore.token0Balance).toBe(amount0);
    expect(balancesAfter.token1Balance - balancesBefore.token1Balance).toBe(amount1);
    expect(positionState.fields.liquidity).toBeGreaterThan(0n);
  });

  test.skip('testnet add liquidity', async () => {
    const nodeProvider = new NodeProvider('https://node.testnet.alephium.org');
    web3.setCurrentNodeProvider(nodeProvider);
    const signer = new PrivateKeyWallet({
      privateKey: process.env.TESTNET_PRIVATE_KEY!,
      keyType: 'gl-secp256k1',
    });

    const amount0 = 195_144_381_020_422_385_005n;
    const amount1 = 20_000_000n;
    const slippage = 0n;

    const tickLower = -300148n;
    const tickUpper = -299148n;
    const configIndex = 1n;


    const token0 = ALPH_TOKEN_ID
    const token1 = '1b14c35ca6f3036b686fde224ce0245ecb34cd9da66ec5e5cf6dae985b9ec203';
    const powfi = new Powfi({
      signer,
      networkId: "testnet"
    })
    const result = await powfi.clmm.addLiquidity({
      token0,
      token1,
      configIndex: configIndex,
      owner: signer.address,
      tickLower,
      tickUpper,
      slippage,
      amount0,
      amount1,
      existingPosition: true,
    });
    console.log(result)
  });

  test.skip('testnet remove liquidity', async () => {
    const nodeProvider = new NodeProvider('https://node.testnet.alephium.org');
    web3.setCurrentNodeProvider(nodeProvider);
    const signer = new PrivateKeyWallet({
      privateKey: process.env.TESTNET_PRIVATE_KEY!,
      keyType: 'gl-secp256k1'
    });

    const tickLower = -300148n;
    const tickUpper = -299148n;
    const configIndex = 1n;
    const amount1 = 19_000_000n;

    const token0 = ALPH_TOKEN_ID
    const token1 = '1b14c35ca6f3036b686fde224ce0245ecb34cd9da66ec5e5cf6dae985b9ec203';
    const powfi = new Powfi({
      signer,
      networkId: "testnet"
    })
    const poolId = powfi.clmm.getPoolId(token0, token1, configIndex)
    const positionId = powfi.clmm.getPositionId(poolId, signer.address, tickLower, tickUpper)
    const position = await Position.at(addressFromContractId(positionId)).fetchState();
    const result = await powfi.clmm.removeLiquidity({
      token0,
      token1,
      configIndex: configIndex,
      owner: signer.address,
      tickLower,
      tickUpper,
      liquidity: position.fields.liquidity,
      base: "token1",
      baseAmount: 0n,
      otherAmountMax: 0n
    });
    console.log(result)
  });

  test('testing failing case', async () => {
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

  test('mint only part of liquidity, because of slippage', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.8, 1.2);

    const token0 = fixture.tokenId0;
    const token1 = fixture.tokenId1;

    const [amount0, amount1] = ClmmLiquidityUtils.getAmountsForLiquidity(
      sqrtPriceCurrent,
      TickUtils.getSqrtRatioAtTick(tickLower),
      TickUtils.getSqrtRatioAtTick(tickUpper),
      10_000n,
    );
    const slippage = 250n;

    const [positionId, positionManager, params] = await fixture.powfi.clmm.getAddLiquidityParams({
      token0,
      token1,
      configIndex,
      tickLower,
      tickUpper,
      amount0,
      amount1,
      slippage,
      existingPosition: false,
    });

    const maxLiquidity = ClmmLiquidityUtils.getLiquidityFromAmounts(
      sqrtPriceCurrent,
      TickUtils.getSqrtRatioAtTick(tickLower),
      TickUtils.getSqrtRatioAtTick(tickUpper),
      amount0,
      amount1
    );

    await fixture.swap(lp2, configIndex, 20n * ONE_ALPH, 250);

    await fixture.powfi.clmm.addLiquidityFromParams(positionId, positionManager, params);

    const positionAddress = addressFromContractId(positionId);
    const positionState = await Position.at(positionAddress).fetchState();

    expect(positionState.fields.liquidity).toBeLessThanOrEqual(maxLiquidity * 9n / 10n);
    expect(positionState.fields.liquidity).toBeGreaterThan(0n);
  });

  test('add liquidity with 0 slippage fails after swap', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const lpAddress = (await lp.getSelectedAccount()).address;
    fixture.powfi.signer = lp;

    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1);

    const token0 = fixture.tokenId0;
    const token1 = fixture.tokenId1;

    const [amount0, amount1] = ClmmLiquidityUtils.getAmountsForLiquidity(
      sqrtPriceCurrent,
      TickUtils.getSqrtRatioAtTick(tickLower),
      TickUtils.getSqrtRatioAtTick(tickUpper),
      10_000n,
    );
    const slippage = 0n;

    const [positionId, positionManager, params] = await fixture.powfi.clmm.getAddLiquidityParams({
      token0,
      token1,
      configIndex,
      owner: lpAddress,
      tickLower,
      tickUpper,
      amount0,
      amount1,
      slippage,
      existingPosition: false,
    });

    await fixture.swap(lp2, configIndex, ONE_ALPH, 30);

    params.signer = lp;
    await expect(fixture.powfi.clmm.addLiquidityFromParams(positionId, positionManager, params))
      .rejects.toThrow(/Error Code: 850/);
  });

  test('add liquidity with 0 slippage succeeds without swap', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1);

    const [amount0, amount1] = ClmmLiquidityUtils.getAmountsForLiquidity(
      sqrtPriceCurrent,
      TickUtils.getSqrtRatioAtTick(tickLower),
      TickUtils.getSqrtRatioAtTick(tickUpper),
      10_000n,
    );
    const slippage = 0n;

    await fixture.addLiquidity(lp, configIndex, amount0, amount1, slippage, tickLower, tickUpper);
  });

  test('mint no liquidity, because of slippage', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.0);
    const token0 = fixture.tokenId0;
    const token1 = fixture.tokenId1;
    const owner = (await lp.getSelectedAccount()).address;

    // Get add liquidity params
    const amount0 = 0n;
    const amount1 = ONE_ALPH;
    const slippage = 30n;

    const [positionId, positionManager, params] = await fixture.powfi.clmm.getAddLiquidityParams({
      token0,
      token1,
      configIndex,
      owner,
      tickLower,
      tickUpper,
      amount0,
      amount1,
      slippage,
      existingPosition: false,
    });

    await fixture.swap(lp2, configIndex, ONE_ALPH, 30);

    try {
      await fixture.powfi.clmm.addLiquidityFromParams(positionId, positionManager, params);

      const positionAddress = addressFromContractId(positionId);
      const positionState = await Position.at(positionAddress).fetchState();
      expect(positionState.fields.liquidity).toBe(0n);
    } catch (error: any) {
      expect(error.message).toMatch(/Error Code: 107/);
    }
  });

  test('getPoolTokenBalances returns correct balances after adding liquidity', async () => {
    const { configIndex, pool } = await fixture.setupPool();
    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1);

    // Get initial pool balances
    const balancesBefore = await fixture.powfi.clmm.getPoolTokenBalances(pool.contractId);

    const amount0Desired = 100n * ONE_ALPH;
    const { amount0, amount1 } = await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: { tickLower, tickUpper },
      amount0Desired,
      amount1Desired: UNLIMITED_AMOUNT,
    });

    // Get pool balances after adding liquidity
    const balancesAfter = await fixture.powfi.clmm.getPoolTokenBalances(pool.contractId);

    // Verify the exact difference matches what was added
    expect(balancesAfter.token0Balance - balancesBefore.token0Balance).toBe(amount0);
    expect(balancesAfter.token1Balance - balancesBefore.token1Balance).toBe(amount1);
  });
});
