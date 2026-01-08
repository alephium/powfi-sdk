import { TickUtils } from '../../src/clmm/tick';
import { UNLIMITED_AMOUNT } from '../../src/clmm/constants';
import type { TokenInfo } from '@alephium/token-list';
import { Zeta } from '../../src/zeta';
import { ClmmLiquidityUtils } from '../../src/clmm/liquidity';
import { GetPositionAmountsFromPriceReturn } from '../../src';

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
  }): GetPositionAmountsFromPriceReturn => {
    const result = ClmmLiquidityUtils.getPositionAmountsFromPrice({
      sqrtRatioX96: sqrtPriceX96,
      tokenBaseId: tokenBase.id,
      tokenQuoteId: tokenQuote.id,
      lowerTick,
      upperTick,
      amountBase,
      amountQuote,
    });
    const { newAmountBase: usedBase, newAmountQuote: usedQuote, liquidity } = result;

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

    test('should handle base < quote, reverse = false', () => {
      const currentPrice = 3000;
      const priceResult = TickUtils.getAlignedPrice(currentPrice, USDC, WETH, 1n, true);
      const centerTick = priceResult.tick;
      const sqrtPriceX96 = TickUtils.getSqrtRatioAtTick(centerTick);
      const lowerTick = centerTick - 5000n;
      const upperTick = centerTick + 5000n;

      const amountUSDC = 1000n * 10n ** 6n; // 1000 USDC
      const amountWETH = 5n * 10n ** 17n; // 0.5 WETH

      const result = ClmmLiquidityUtils.getPositionAmountsFromPrice({
        sqrtRatioX96: sqrtPriceX96,
        tokenBaseId: USDC.id,
        tokenQuoteId: WETH.id,
        lowerTick,
        upperTick,
        amountBase: amountUSDC,
        amountQuote: amountWETH,
      });

      const { newAmountBase: usedUSDC, newAmountQuote: usedWETH, liquidity } = result;
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

      const { newAmountBase: usedWETH, newAmountQuote: usedUSDC, liquidity } = ClmmLiquidityUtils.getPositionAmountsFromPrice({
        sqrtRatioX96: sqrtPriceX96,
        tokenBaseId: WETH.id,
        tokenQuoteId: USDC.id,
        lowerTick,
        upperTick,
        amountBase: amountWETH,
        amountQuote: amountUSDC,
      });

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

      const normalResult = ClmmLiquidityUtils.getPositionAmountsFromPrice({
        sqrtRatioX96: sqrtPriceX96,
        tokenBaseId: USDC.id,
        tokenQuoteId: WETH.id,
        lowerTick: normalLowerTick,
        upperTick: normalUpperTick,
        amountBase: amountUSDC,
        amountQuote: amountWETH,
      });

      const reversedResult = ClmmLiquidityUtils.getPositionAmountsFromPrice({
        sqrtRatioX96: sqrtPriceX96,
        tokenBaseId: WETH.id,
        tokenQuoteId: USDC.id,
        lowerTick: reversedLowerTick,
        upperTick: reversedUpperTick,
        amountBase: amountWETH,
        amountQuote: amountUSDC,
      });

      const { newAmountBase: usedUSDC, newAmountQuote: usedWETH, liquidity } = normalResult;
      const { newAmountBase: usedWETHReversed, newAmountQuote: usedUSDCReversed, liquidity: liquidityReversed } = reversedResult;

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
      const { newAmountBase: usedUSDC1, liquidity: liquidity1 } = ClmmLiquidityUtils.getPositionAmountsFromPrice({
        sqrtRatioX96: sqrtPriceX96,
        tokenBaseId: USDC.id,
        tokenQuoteId: WETH.id,
        lowerTick,
        upperTick,
        amountBase: limitedUSDC,
        amountQuote: UNLIMITED_AMOUNT,
      });

      const limitedWETH = 3n * 10n ** 18n;
      const { newAmountQuote: usedWETH2, liquidity: liquidity2 } = ClmmLiquidityUtils.getPositionAmountsFromPrice({
        sqrtRatioX96: sqrtPriceX96,
        tokenBaseId: USDC.id,
        tokenQuoteId: WETH.id,
        lowerTick,
        upperTick,
        amountBase: UNLIMITED_AMOUNT,
        amountQuote: limitedWETH,
      });

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
        const { newAmountBase: usedUSDC, liquidity: liquidityUSDC } = ClmmLiquidityUtils.getPositionAmountsFromPrice({
          sqrtRatioX96: sqrtPriceX96,
          tokenBaseId: USDC.id,
          tokenQuoteId: WETH.id,
          lowerTick,
          upperTick,
          amountBase: testCase.amount,
          amountQuote: UNLIMITED_AMOUNT,
        });

        const { newAmountQuote: usedWETH2, liquidity: liquidityWETH } = ClmmLiquidityUtils.getPositionAmountsFromPrice({
          sqrtRatioX96: sqrtPriceX96,
          tokenBaseId: USDC.id,
          tokenQuoteId: WETH.id,
          lowerTick,
          upperTick,
          amountBase: UNLIMITED_AMOUNT,
          amountQuote: testCase.amount,
        });

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
    });
  });
});
