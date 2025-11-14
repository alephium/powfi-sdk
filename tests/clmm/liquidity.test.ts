import { TickUtils } from '../../src/clmm/tick';
import { UNLIMITED_AMOUNT } from '../../src/clmm/constants';
import type { TokenInfo } from '@alephium/token-list';
import { Zeta } from '../../src/zeta';
import { ClmmLiquidityUtils } from '../../src/clmm/liquidity';

describe('LiquidityUtils', () => {
  const createToken = (id: string, decimals: number): TokenInfo => ({
    id,
    decimals,
    symbol: 'TEST',
    name: 'Test Token',
    description: 'Test token',
    logoURI: '',
  });

  const expectPercentageDiff = (
    actual: number | bigint,
    expected: number | bigint,
    maxPercentDiff: number,
    message?: string,
  ) => {
    const actualNum = Number(actual);
    const expectedNum = Number(expected);
    if (expectedNum === 0) {
      expect(actualNum).toBe(0);
      return;
    }
    const percentDiff = Math.abs((actualNum - expectedNum) / expectedNum) * 100;
    if (percentDiff > maxPercentDiff) {
      throw new Error(
        `${message || 'Percentage difference too large'}: ` +
          `actual=${actualNum}, expected=${expectedNum}, ` +
          `diff=${percentDiff.toFixed(6)}%, max=${maxPercentDiff}%`,
      );
    }
  };

  const expectPositionAmounts = ({
    sqrtPriceX96,
    tokenBase,
    tokenQuote,
    lowerTick,
    upperTick,
    amountBase,
    amountQuote,
    expectedBase,
    expectedQuote,
    expectedLiquidity,
  }: {
    sqrtPriceX96: bigint;
    tokenBase: TokenInfo;
    tokenQuote: TokenInfo;
    lowerTick: bigint;
    upperTick: bigint;
    amountBase: bigint;
    amountQuote: bigint;
    expectedBase?: bigint;
    expectedQuote?: bigint;
    expectedLiquidity?: bigint;
  }): [bigint, bigint, bigint] => {
    const result = ClmmLiquidityUtils.getPositionAmountsFromPrice(
      sqrtPriceX96,
      tokenBase,
      tokenQuote,
      lowerTick,
      upperTick,
      amountBase,
      amountQuote,
    );
    const [usedBase, usedQuote, liquidity] = result;

    if (expectedBase !== undefined) {
      expect(usedBase).toBe(expectedBase);
    }
    if (expectedQuote !== undefined) {
      expect(usedQuote).toBe(expectedQuote);
    }
    if (expectedLiquidity !== undefined) {
      expect(liquidity).toBe(expectedLiquidity);
    }

    return result;
  };

  describe('getPositionAmountsFromPrice', () => {
    const USDCId = '4eba8ba7d0d67f81a2355a423d392bddc39827f230eecfa949d683e91e3e2a00';
    const WETHId = '7d778a437c793697381ed67845a76874305f69fb861f31c9b2a84cf06cba8700';
    const USDC = createToken(USDCId, 6);
    const WETH = createToken(WETHId, 18);

    test('test from running system', () => {
      const tickLower = 265210n;
      const tickUpper = 269295n;
      // 45452066364233268369925812005835272n
      const sqrtPriceX96A = TickUtils.getSqrtRatioAtTick(tickLower);
      // 55751151917851171758765933958365327n
      const sqrtPriceX96B = TickUtils.getSqrtRatioAtTick(tickUpper);
      // [addLiquidity][SPOT]  amount0: 4400000000n amount1: 2317711030407264178626n sqrtPriceX96: 45520292209136196485350413856803117n tick: 265240n
      // [addLiquidity][MIN ]  amount0: 4400000000n amount1: 2287140072585595211262n sqrtPriceX96: 45452066364233268369925812005835272n tick: 265210n
      // [addLiquidity][MAX ]  amount0: 4341807052n amount1: 2317711030407264128863n sqrtPriceX96: 45588620464474668215330498985281758n tick: 265270n
      const sqrtMinPriceX96 = 45452066364233268369925812005835272n;
      const sqrtPriceX96 = 45520292209136196485350413856803117n;
      const sqrtMaxPriceX96 = 45588620464474668215330498985281758n;
      expect(TickUtils.getSqrtRatioAtTick(265210n)).toBe(sqrtMinPriceX96);
      expect(TickUtils.getSqrtRatioAtTick(265240n)).toBe(sqrtPriceX96);
      expect(TickUtils.getSqrtRatioAtTick(265270n)).toBe(sqrtMaxPriceX96);

      expect(TickUtils.getTickAtSqrtRatio(sqrtMinPriceX96)).toBe(265210n);
      expect(TickUtils.getTickAtSqrtRatio(sqrtPriceX96)).toBe(265240n);
      expect(TickUtils.getTickAtSqrtRatio(sqrtMaxPriceX96)).toBe(265270n);

      const amount0 = 4400000000n;
      const amount1 = 2317711030407264178626n;
      const [minAmount0, minAmount1] = ClmmLiquidityUtils.getAmountsAndLiquidityAtSqrtPrice(
        sqrtPriceX96,
        sqrtPriceX96A,
        sqrtPriceX96B,
        amount0,
        amount1,
      );
      const [spotAmount0, spotAmount1] = ClmmLiquidityUtils.getAmountsAndLiquidityAtSqrtPrice(
        sqrtPriceX96,
        sqrtPriceX96A,
        sqrtPriceX96B,
        amount0,
        amount1,
      );
      const [maxAmount0, maxAmount1] = ClmmLiquidityUtils.getAmountsAndLiquidityAtSqrtPrice(
        sqrtMaxPriceX96,
        sqrtPriceX96A,
        sqrtPriceX96B,
        amount0,
        amount1,
      );
      return;
    });

    test('should handle base < quote, reverse = false', () => {
      const currentPrice = 3000;
      const priceResult = TickUtils.getAlignedPrice(currentPrice, USDC, WETH, 1n, true);
      const centerTick = priceResult.tick;
      const sqrtPriceX96 = TickUtils.getSqrtRatioAtTick(centerTick);
      const lowerTick = centerTick - 5000n;
      const upperTick = centerTick + 5000n;

      const amountUSDC = 1000n * 10n ** 6n; // 1000 USDC
      const amountWETH = 5n * 10n ** 17n; // 0.5 WETH

      const result = ClmmLiquidityUtils.getPositionAmountsFromPrice(
        sqrtPriceX96,
        USDC,
        WETH,
        lowerTick,
        upperTick,
        amountUSDC,
        amountWETH,
      );

      const [usedUSDC, usedWETH, liquidity] = result;
      expect(usedUSDC).toBeLessThanOrEqual(amountUSDC);
      expect(usedWETH).toBeLessThanOrEqual(amountWETH);

      const wethShortfall = amountWETH - usedWETH;
      expect(wethShortfall).toBeGreaterThanOrEqual(0n);
      expect(wethShortfall).toBeLessThan(10_000_000n);

      const sqrtLower = TickUtils.getSqrtRatioAtTick(lowerTick);
      const sqrtUpper = TickUtils.getSqrtRatioAtTick(upperTick);

      const liquidityFromWETH = ClmmLiquidityUtils.getLiquidityFromToken1(
        sqrtLower,
        sqrtPriceX96,
        usedWETH,
      );
      expect(liquidity).toBe(liquidityFromWETH);

      const expectedUSDC = -ClmmLiquidityUtils.getToken0Delta(
        sqrtPriceX96,
        sqrtUpper,
        -liquidityFromWETH,
      );
      expect(usedUSDC).toBe(expectedUSDC);
    });

    test('handles inverted ordering (base > quote), reverse = true', () => {
      const currentPrice = 0.000333;
      const poolPriceResult = TickUtils.getAlignedPrice(currentPrice, WETH, USDC, 1n, true);
      const centerTick = poolPriceResult.tick;
      const sqrtPriceX96 = TickUtils.getSqrtRatioAtTick(centerTick);
      const lowerTick = centerTick - 5000n;
      const upperTick = centerTick + 5000n;

      const amountWETH = 5n * 10n ** 17n; // 0.5 WETH
      const amountUSDC = 1000n * 10n ** 6n; // 1000 USDC

      const [usedWETH, usedUSDC, liquidity] = ClmmLiquidityUtils.getPositionAmountsFromPrice(
        sqrtPriceX96,
        WETH,
        USDC,
        lowerTick,
        upperTick,
        amountWETH,
        amountUSDC,
      );

      expect(usedWETH).toBeLessThanOrEqual(amountWETH);
      expect(usedUSDC).toBeLessThanOrEqual(amountUSDC);

      const wethShortfall = amountWETH - usedWETH;
      expect(wethShortfall).toBeGreaterThanOrEqual(0n);
      expect(wethShortfall).toBeLessThan(10_000_000n); // <1e-11 WETH

      const sqrtLower = TickUtils.getSqrtRatioAtTick(lowerTick);
      const sqrtUpper = TickUtils.getSqrtRatioAtTick(upperTick);

      const liquidityFromWETH = ClmmLiquidityUtils.getLiquidityFromToken1(
        sqrtLower,
        sqrtPriceX96,
        usedWETH,
      );
      expect(liquidity).toBe(liquidityFromWETH);

      const expectedUSDC = -ClmmLiquidityUtils.getToken0Delta(
        sqrtPriceX96,
        sqrtUpper,
        -liquidityFromWETH,
      );
      expect(usedUSDC).toBe(expectedUSDC);
    });

    test('preserves amounts and liquidity for inverse pricing', () => {
      const priceUSDCPerWETH = 2500;
      const priceWETHPerUSDC = 1 / priceUSDCPerWETH;

      const normalPriceResult = TickUtils.getAlignedPrice(priceUSDCPerWETH, USDC, WETH, 1n, true);
      const sqrtPriceX96 = TickUtils.getSqrtRatioAtTick(normalPriceResult.tick);
      const normalLowerTick = normalPriceResult.tick - 2000n;
      const normalUpperTick = normalPriceResult.tick + 2000n;

      // For reversed case (WETH > USDC), we need to think in pool's native terms
      // The pool will use USDC=token0, WETH=token1, so use the same tick range
      const reversedLowerTick = normalUpperTick;
      const reversedUpperTick = normalLowerTick;

      const amountUSDC = 2500n * 10n ** 6n; // 2500 USDC
      const amountWETH = 1n * 10n ** 18n; // 1 WETH

      const normalResult = ClmmLiquidityUtils.getPositionAmountsFromPrice(
        sqrtPriceX96,
        USDC,
        WETH,
        normalLowerTick,
        normalUpperTick,
        amountUSDC,
        amountWETH,
      );

      const reversedResult = ClmmLiquidityUtils.getPositionAmountsFromPrice(
        sqrtPriceX96,
        WETH,
        USDC,
        reversedLowerTick,
        reversedUpperTick,
        amountWETH,
        amountUSDC,
      );

      const [usedUSDC, usedWETH, liquidity] = normalResult;
      const [usedWETHReversed, usedUSDCReversed, liquidityReversed] = reversedResult;

      expect(liquidity).toBeGreaterThan(0n);
      expect(liquidityReversed).toBeGreaterThan(0n);
      expect(liquidityReversed).toBe(liquidity);

      expect(usedUSDC).toBe(usedUSDCReversed);
      expect(usedWETH).toBe(usedWETHReversed);

      const wethShortfall = amountWETH - usedWETH;
      const wethShortfallReversed = amountWETH - usedWETHReversed;
      const usdcShortfall = amountUSDC - usedUSDC;
      const usdcShortfallReversed = amountUSDC - usedUSDCReversed;
      expect(wethShortfall).toBe(wethShortfallReversed);
      expect(usdcShortfall).toBe(usdcShortfallReversed);
      expect(wethShortfall).toBeLessThan(10_000_000n);

      const { price: roundedPrice } = TickUtils.getAlignedPrice(
        priceUSDCPerWETH,
        USDC,
        WETH,
        1n,
        true,
      );
      const sqrtCurrent = TickUtils.priceToSqrtPriceX96(roundedPrice, USDC.decimals, WETH.decimals);
      const sqrtLower = TickUtils.getSqrtRatioAtTick(normalLowerTick);
      const sqrtUpper = TickUtils.getSqrtRatioAtTick(normalUpperTick);

      const liquidityFromWETH = ClmmLiquidityUtils.getLiquidityFromToken1(
        sqrtLower,
        sqrtCurrent,
        usedWETH,
      );
      expect(liquidity).toBe(liquidityFromWETH);

      const expectedUSDC = -ClmmLiquidityUtils.getToken0Delta(
        sqrtCurrent,
        sqrtUpper,
        -liquidityFromWETH,
      );
      expect(usedUSDC).toBe(expectedUSDC);
    });

    test('should work with UNLIMITED_AMOUNT constant for single-sided liquidity', () => {
      const currentPrice = 1500;
      const priceResult = TickUtils.getAlignedPrice(currentPrice, USDC, WETH, 1n, true);
      const sqrtPriceX96 = TickUtils.getSqrtRatioAtTick(priceResult.tick);
      const lowerTick = priceResult.tick - 3000n;
      const upperTick = priceResult.tick + 3000n;

      const limitedUSDC = 5000n * 10n ** 6n;
      const [usedUSDC1, , liquidity1] = ClmmLiquidityUtils.getPositionAmountsFromPrice(
        sqrtPriceX96,
        USDC,
        WETH,
        lowerTick,
        upperTick,
        limitedUSDC,
        UNLIMITED_AMOUNT,
      );

      const limitedWETH = 3n * 10n ** 18n;
      const [, usedWETH2, liquidity2] = ClmmLiquidityUtils.getPositionAmountsFromPrice(
        sqrtPriceX96,
        USDC,
        WETH,
        lowerTick,
        upperTick,
        UNLIMITED_AMOUNT,
        limitedWETH,
      );

      expect(usedUSDC1).toBeLessThanOrEqual(limitedUSDC);
      expect(usedWETH2).toBeLessThanOrEqual(limitedWETH);

      expectPercentageDiff(usedUSDC1, limitedUSDC, 0.1, 'USDC');
      expectPercentageDiff(usedWETH2, limitedWETH, 0.001, 'WETH');

      expect(liquidity1).toBeGreaterThan(0n);
      expect(liquidity2).toBeGreaterThan(0n);
    });

    test('should handle zero amount with UNLIMITED_AMOUNT', () => {
      const currentPrice = 2000;
      const priceResult = TickUtils.getAlignedPrice(currentPrice, USDC, WETH, 1n, true);
      const sqrtPriceX96 = TickUtils.getSqrtRatioAtTick(priceResult.tick);
      const lowerTick = priceResult.tick - 5000n;
      const upperTick = priceResult.tick + 5000n;

      // zero base with unlimited quote
      expectPositionAmounts({
        sqrtPriceX96,
        tokenBase: USDC,
        tokenQuote: WETH,
        lowerTick,
        upperTick,
        amountBase: 0n,
        amountQuote: UNLIMITED_AMOUNT,
        expectedBase: 0n,
        expectedQuote: 0n,
        expectedLiquidity: 0n,
      });

      // zero quote with unlimited base
      expectPositionAmounts({
        sqrtPriceX96,
        tokenBase: USDC,
        tokenQuote: WETH,
        lowerTick,
        upperTick,
        amountBase: UNLIMITED_AMOUNT,
        amountQuote: 0n,
        expectedBase: 0n,
        expectedQuote: 0n,
        expectedLiquidity: 0n,
      });
    });

    test('should handle very small amounts correctly', () => {
      const currentPrice = 2000;
      const priceResult = TickUtils.getAlignedPrice(currentPrice, USDC, WETH, 1n, true);
      const sqrtPriceX96 = TickUtils.getSqrtRatioAtTick(priceResult.tick);
      const lowerTick = priceResult.tick - 5000n;
      const upperTick = priceResult.tick + 5000n;

      const smallestUSDC = 1n; // 0.000001 USDC
      const smallestWETH = 1n; // 0.000000000000000001 WETH

      const smallUSDC = 1000n; // 0.001 USDC
      const smallWETH = 1_000_000_000_000n; // 0.000001 WETH

      const sqrtLower = TickUtils.getSqrtRatioAtTick(lowerTick);
      const sqrtUpper = TickUtils.getSqrtRatioAtTick(upperTick);

      const getExpectedAmounts = (liquidity: bigint): [bigint, bigint] => {
        const [rawAmount0, rawAmount1] = ClmmLiquidityUtils.getAmountsForLiquidity(
          sqrtPriceX96,
          sqrtLower,
          sqrtUpper,
          -liquidity,
        );
        return [-rawAmount0, -rawAmount1];
      };

      const expectedLiquidityFromUSDC1 = ClmmLiquidityUtils.getLiquidityFromToken0(
        sqrtPriceX96,
        sqrtUpper,
        smallestUSDC,
      );
      const [expectedUSDCFromUSDC1, expectedWETHFromUSDC1] = getExpectedAmounts(
        expectedLiquidityFromUSDC1,
      );

      // 1 μUSDC with unlimited WETH
      expectPositionAmounts({
        sqrtPriceX96,
        tokenBase: USDC,
        tokenQuote: WETH,
        lowerTick,
        upperTick,
        amountBase: smallestUSDC,
        amountQuote: UNLIMITED_AMOUNT,
        expectedBase: expectedUSDCFromUSDC1,
        expectedQuote: expectedWETHFromUSDC1,
        expectedLiquidity: expectedLiquidityFromUSDC1,
      });

      // 1 wei WETH with unlimited USDC
      expectPositionAmounts({
        sqrtPriceX96,
        tokenBase: USDC,
        tokenQuote: WETH,
        lowerTick,
        upperTick,
        amountBase: UNLIMITED_AMOUNT,
        amountQuote: smallestWETH,
        expectedBase: 0n,
        expectedQuote: 0n,
        expectedLiquidity: 0n,
      });

      // both tokens minimal
      expectPositionAmounts({
        sqrtPriceX96,
        tokenBase: USDC,
        tokenQuote: WETH,
        lowerTick,
        upperTick,
        amountBase: smallestUSDC,
        amountQuote: smallestWETH,
        expectedBase: 0n,
        expectedQuote: 0n,
        expectedLiquidity: 0n,
      });

      const expectedLiquidityFromUSDC4 = ClmmLiquidityUtils.getLiquidityFromToken0(
        sqrtPriceX96,
        sqrtUpper,
        smallUSDC,
      );
      const [expectedUSDCFromUSDC4, expectedWETHFromUSDC4] = getExpectedAmounts(
        expectedLiquidityFromUSDC4,
      );

      // 0.001 USDC with unlimited WETH
      expectPositionAmounts({
        sqrtPriceX96,
        tokenBase: USDC,
        tokenQuote: WETH,
        lowerTick,
        upperTick,
        amountBase: smallUSDC,
        amountQuote: UNLIMITED_AMOUNT,
        expectedBase: expectedUSDCFromUSDC4,
        expectedQuote: expectedWETHFromUSDC4,
        expectedLiquidity: expectedLiquidityFromUSDC4,
      });

      const expectedLiquidityFromWETH5 = ClmmLiquidityUtils.getLiquidityFromToken1(
        sqrtLower,
        sqrtPriceX96,
        smallWETH,
      );
      const [expectedUSDCFromWETH5, expectedWETHFromWETH5] = getExpectedAmounts(
        expectedLiquidityFromWETH5,
      );

      // 1e-6 WETH with unlimited USDC
      expectPositionAmounts({
        sqrtPriceX96,
        tokenBase: USDC,
        tokenQuote: WETH,
        lowerTick,
        upperTick,
        amountBase: UNLIMITED_AMOUNT,
        amountQuote: smallWETH,
        expectedBase: expectedUSDCFromWETH5,
        expectedQuote: expectedWETHFromWETH5,
        expectedLiquidity: expectedLiquidityFromWETH5,
      });
    });

    test('should handle various small finite amounts correctly', () => {
      const currentPrice = 1500; // $1500 per ETH
      const priceResult = TickUtils.getAlignedPrice(currentPrice, USDC, WETH, 1n, true);
      const sqrtPriceX96 = TickUtils.getSqrtRatioAtTick(priceResult.tick);
      const lowerTick = priceResult.tick - 5000n;
      const upperTick = priceResult.tick + 5000n;

      const testCases = [
        { amount: 1n * 10n ** 6n, description: '1 USDC' },
        { amount: 100n * 10n ** 6n, description: '100 USDC' },
        { amount: 1000n * 10n ** 6n, description: '1000 USDC' },
        { amount: 1n * 10n ** 18n, description: '1 WETH' },
        { amount: 10n * 10n ** 18n, description: '10 WETH' },
      ];

      for (const testCase of testCases) {
        const [usedUSDC, , liquidityUSDC] = ClmmLiquidityUtils.getPositionAmountsFromPrice(
          sqrtPriceX96,
          USDC,
          WETH,
          lowerTick,
          upperTick,
          testCase.amount,
          UNLIMITED_AMOUNT,
        );

        const [, usedWETH2, liquidityWETH] = ClmmLiquidityUtils.getPositionAmountsFromPrice(
          sqrtPriceX96,
          USDC,
          WETH,
          lowerTick,
          upperTick,
          UNLIMITED_AMOUNT,
          testCase.amount,
        );

        expect(usedUSDC).toBeGreaterThanOrEqual(0n);
        expect(usedWETH2).toBeGreaterThanOrEqual(0n);

        expect(usedUSDC).toBeLessThanOrEqual(testCase.amount);
        expect(usedWETH2).toBeLessThanOrEqual(testCase.amount);

        expect(liquidityUSDC).toBeGreaterThanOrEqual(0n);
        expect(liquidityWETH).toBeGreaterThanOrEqual(0n);
      }
    });
  });

  describe('poolExists function', () => {
    test('should return false for non-existent pool', async () => {
      const zeta = new Zeta({ networkId: 'devnet' });
      zeta.setCurrentProviders();

      const fakeToken0 = '0000000000000000000000000000000000000000000000000000000000000001';
      const fakeToken1 = '0000000000000000000000000000000000000000000000000000000000000002';
      const configIndex = 0n;

      const exists = await zeta.clmm.poolExists(fakeToken0, fakeToken1, configIndex);
      expect(exists).toBe(false);

      const result = await zeta.clmm.findBestRoute(fakeToken0, fakeToken1);
      expect(result).toBe(-1n);
    });
  });
});
