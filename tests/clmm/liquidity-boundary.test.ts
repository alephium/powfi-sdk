import { ClmmLiquidityUtils } from '../../src/clmm/liquidity'
import { TickUtils } from '../../src/clmm/tick'

// Mirrors the on-chain LiquidityAmounts.getLiquidityForAmounts boundary behaviour.
describe('ClmmLiquidityUtils.getLiquidityFromAmounts at the lower tick', () => {
  const tickLower = -276000n
  const tickUpper = tickLower + 600n
  const sqrtA = TickUtils.getSqrtRatioAtTick(tickLower)
  const sqrtB = TickUtils.getSqrtRatioAtTick(tickUpper)
  const amount0 = 10n ** 18n

  it('treats a price exactly on the lower tick as token0-only', () => {
    const atBoundary = ClmmLiquidityUtils.getLiquidityFromAmounts(sqrtA, sqrtA, sqrtB, amount0, 0n)
    const below = ClmmLiquidityUtils.getLiquidityFromAmounts(sqrtA - 1n, sqrtA, sqrtB, amount0, 0n)
    expect(atBoundary).toBe(below)
    expect(atBoundary).toBeGreaterThan(0n)
  })

  it('returns zero liquidity for a token0-only deposit once the price is inside the lower tick', () => {
    // This is the case the contract rejects with Pool error 107 (CannotCreateEmptyPosition).
    expect(ClmmLiquidityUtils.getLiquidityFromAmounts(sqrtA + 1n, sqrtA, sqrtB, amount0, 0n)).toBe(0n)
  })
})
