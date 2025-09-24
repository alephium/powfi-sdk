import { CpmmModule } from '../../src/cpmm/cpmm';
import { MINIMUM_LIQUIDITY } from '../../src/cpmm/constants';
import { InsufficientLiquidityError } from '../../src/common/error';
import { MathUtil } from '../../src/common/math';
import type { TokenInfo } from '@alephium/token-list';
import type { CpmmPoolState } from '../../src/cpmm/types';
import { ONE_ALPH } from '@alephium/web3';

describe('CpmmModule functions', () => {
  const createTokenInfo = (id: string, decimals: number): TokenInfo => ({
    id,
    decimals,
    name: `Token ${id}`,
    symbol: id.slice(0, 3).toUpperCase(),
    description: `Test Token ${id}`,
    logoURI: '',
  });

  const createPoolState = ({
    reserve0,
    reserve1,
    token0 = createTokenInfo('token0', 18),
    token1 = createTokenInfo('token1', 18),
    poolId = 'mock-pair-id',
  }: {
    reserve0: bigint;
    reserve1: bigint;
    token0?: TokenInfo;
    token1?: TokenInfo;
    poolId?: string;
  }): CpmmPoolState => ({
    poolId,
    token0Info: token0,
    token1Info: token1,
    reserve0,
    reserve1,
    totalSupply: MathUtil.sqrt(reserve0 * reserve1),
  });

  const mockCpmmPoolState = createPoolState({
    reserve0: ONE_ALPH * 1000n,
    reserve1: ONE_ALPH * 2000n,
  });

  const percent = (value: bigint, total: bigint): number => Number((value * 10000n) / total) / 100;

  describe('getAmountOut', () => {
    it('returns the output amount for token0 -> token1 swaps', () => {
      const amountIn = ONE_ALPH * 100n;
      const result = CpmmModule.getAmountOut(mockCpmmPoolState, 'token0', amountIn);

      const amountInExcludeFee = amountIn * 997n;
      const expected =
        (amountInExcludeFee * mockCpmmPoolState.reserve1) /
        (amountInExcludeFee + 1000n * mockCpmmPoolState.reserve0);

      expect(result).toBe(expected);
    });

    it('returns the output amount for token1 -> token0 swaps', () => {
      const amountIn = ONE_ALPH * 200n;
      const result = CpmmModule.getAmountOut(mockCpmmPoolState, 'token1', amountIn);

      const amountInExcludeFee = amountIn * 997n;
      const expected =
        (amountInExcludeFee * mockCpmmPoolState.reserve0) /
        (amountInExcludeFee + 1000n * mockCpmmPoolState.reserve1);

      expect(result).toBe(expected);
    });
  });

  describe('getAmountIn', () => {
    it('returns the input amount required for a desired output', () => {
      const amountOut = ONE_ALPH * 90n;
      const result = CpmmModule.getAmountIn(mockCpmmPoolState, 'token0', amountOut);

      const reserveIn = mockCpmmPoolState.reserve1;
      const reserveOut = mockCpmmPoolState.reserve0 - amountOut;
      const numerator = reserveIn * amountOut * 1000n;
      const denominator = reserveOut * 997n;
      const expected = numerator / denominator + 1n;

      expect(result).toBe(expected);
    });

    it('throws if the desired output exceeds pool reserves', () => {
      const amountOut = ONE_ALPH * 1001n; // More than reserve0

      expect(() => CpmmModule.getAmountIn(mockCpmmPoolState, 'token0', amountOut)).toThrow(
        InsufficientLiquidityError,
      );
    });
  });

  describe('getInitLiquidityDetails', () => {
    it('computes initial liquidity information', () => {
      const amountA = ONE_ALPH * 1000n;
      const amountB = ONE_ALPH * 2000n;

      const result = CpmmModule.getInitLiquidityDetails('tokenA', 'tokenB', amountA, amountB);

      expect(result.tokenAId).toBe('tokenA');
      expect(result.tokenBId).toBe('tokenB');
      expect(result.amountA).toBe(amountA);
      expect(result.amountB).toBe(amountB);
      expect(result.shareAmount).toBe(MathUtil.sqrt(amountA * amountB) - MINIMUM_LIQUIDITY);
      expect(result.sharePercentage).toBe(100);
    });

    it('throws when initial liquidity is insufficient', () => {
      expect(() => CpmmModule.getInitLiquidityDetails('tokenA', 'tokenB', 100n, 100n)).toThrow(
        InsufficientLiquidityError,
      );
    });
  });

  describe('getLiquidityDetails', () => {
    it('derives proportional amounts for TokenA input', () => {
      const result = CpmmModule.getLiquidityDetails(
        mockCpmmPoolState,
        mockCpmmPoolState.token0Info.id,
        ONE_ALPH * 100n,
        'TokenA',
      );

      expect(result.tokenAId).toBe(mockCpmmPoolState.token0Info.id);
      expect(result.tokenBId).toBe(mockCpmmPoolState.token1Info.id);
      expect(result.amountA).toBe(ONE_ALPH * 100n);
      expect(result.amountB).toBe(ONE_ALPH * 200n);
      expect(result.shareAmount).toBe(141421356237309504880n);
      expect(result.sharePercentage).toBeCloseTo(9.0909, 4);
    });

    it('derives proportional amounts for TokenB input', () => {
      const inputAmount = ONE_ALPH * 250n;
      const result = CpmmModule.getLiquidityDetails(
        mockCpmmPoolState,
        mockCpmmPoolState.token1Info.id,
        inputAmount,
        'TokenB',
      );

      expect(result.tokenAId).toBe(mockCpmmPoolState.token0Info.id);
      expect(result.tokenBId).toBe(mockCpmmPoolState.token1Info.id);

      expect(result.amountA).toBe(
        (inputAmount * mockCpmmPoolState.reserve0) / mockCpmmPoolState.reserve1,
      );
      expect(result.amountB).toBe(inputAmount);
      expect(result.shareAmount).toBe(176776695296636881100n);
      expect(result.sharePercentage).toBeCloseTo(11.1111, 4);
    });

    it('handles token1 labeled as TokenA (UI swap scenario)', () => {
      const inputAmount = ONE_ALPH * 150n;
      const result = CpmmModule.getLiquidityDetails(
        mockCpmmPoolState,
        mockCpmmPoolState.token1Info.id,
        inputAmount,
        'TokenA',
      );

      expect(result.tokenAId).toBe(mockCpmmPoolState.token1Info.id);
      expect(result.tokenBId).toBe(mockCpmmPoolState.token0Info.id);
      expect(result.amountA).toBe(inputAmount);
      expect(result.amountB).toBe(
        (inputAmount * mockCpmmPoolState.reserve0) / mockCpmmPoolState.reserve1,
      );
      expect(result.shareAmount).toBe(106066017177982128660n);
      expect(result.sharePercentage).toBeCloseTo(6.9767, 4);
    });
  });

  describe('minimalAmount and maximalAmount', () => {
    const sampleAmount = 1_000_000n;
    const BPS = 10_000n;

    it('reduces minimalAmount proportional to slippage', () => {
      const slippage = 100n;
      const expected = (sampleAmount * BPS) / (BPS + slippage);
      expect(CpmmModule.minimalAmount(sampleAmount, slippage)).toBe(expected);
    });

    it('increases maximalAmount proportional to slippage (ceil)', () => {
      const amount = 1_000_001n;
      const slippage = 25n;
      const expected = (amount * (BPS + slippage) + (BPS - 1n)) / BPS;
      expect(CpmmModule.maximalAmount(amount, slippage)).toBe(expected);
    });

    it('rejects negative slippage', () => {
      expect(() => CpmmModule.minimalAmount(sampleAmount, -1n)).toThrow(/Slippage must satisfy/);
      expect(() => CpmmModule.maximalAmount(sampleAmount, -1n)).toThrow(/Slippage must satisfy/);
    });

    it('rejects slippage >= 10000 bps', () => {
      expect(() => CpmmModule.minimalAmount(sampleAmount, 10_000n)).toThrow(
        /Slippage must satisfy/,
      );
      expect(() => CpmmModule.maximalAmount(sampleAmount, 10_000n)).toThrow(
        /Slippage must satisfy/,
      );
    });

    it('accepts valid slippage', () => {
      expect(() => CpmmModule.minimalAmount(sampleAmount, 500n)).not.toThrow();
      expect(() => CpmmModule.maximalAmount(sampleAmount, 500n)).not.toThrow();
    });
  });

  describe('computeRemoveLiquidityAmounts', () => {
    it('returns proportional withdrawal amounts', () => {
      const totalLiquidity = ONE_ALPH * 1000n;
      const liquidityToRemove = ONE_ALPH * 100n; // 10% of total

      const result = CpmmModule.computeRemoveLiquidityAmounts(
        mockCpmmPoolState,
        totalLiquidity,
        liquidityToRemove,
      );

      expect(result.token0Id).toBe('token0');
      expect(result.token1Id).toBe('token1');
      const expectedAmount0 =
        (liquidityToRemove * mockCpmmPoolState.reserve0) / mockCpmmPoolState.totalSupply;
      const expectedAmount1 =
        (liquidityToRemove * mockCpmmPoolState.reserve1) / mockCpmmPoolState.totalSupply;
      expect(result.amount0).toBe(expectedAmount0);
      expect(result.amount1).toBe(expectedAmount1);

      const expectedRemainShareAmount = totalLiquidity - liquidityToRemove;
      expect(result.remainShareAmount).toBe(expectedRemainShareAmount);

      const initialSharePercentage = percent(totalLiquidity, mockCpmmPoolState.totalSupply);

      expect(initialSharePercentage).toBeCloseTo(70.71, 2);
      expect(result.remainSharePercentage).toBeCloseTo(68.48, 2);
    });

    it('throws when attempting to withdraw more liquidity than exists', () => {
      const totalLiquidity = ONE_ALPH * 1000n;
      const liquidityToRemove = ONE_ALPH * 1001n;

      expect(() =>
        CpmmModule.computeRemoveLiquidityAmounts(
          mockCpmmPoolState,
          totalLiquidity,
          liquidityToRemove,
        ),
      ).toThrow('Liquidity exceeds total liquidity amount');
    });
  });
});
