import { web3 } from '@alephium/web3'
import type { PoolTypes } from 'clmm'
import { LiquidityAmountsTest, Pool } from 'clmm'
import { MAX_SQRT_RATIO, MAX_TICK, MIN_SQRT_RATIO, MIN_TICK } from 'clmm/artifacts/ts/constants'
import { ClmmLiquidityUtils } from '../../../src/clmm/liquidity'
import { TickUtils } from '../../../src/clmm/tick'

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch)

// The SDK decides off-chain which tokens a position needs. When it disagrees with the pool contract at a tick
// boundary, the user sends the wrong amounts and the mint fails (e.g. Pool error 107, CannotCreateEmptyPosition).
describe('CLMM math parity with the contracts', () => {
  const poolFields = Pool.contract.getInitialFieldsWithDefaultValues() as PoolTypes.Fields

  const chainSqrtRatioAtTick = async (tick: bigint) =>
    (await Pool.tests.getSqrtRatioAtTick({ initialFields: poolFields, args: { tick } })).returns

  const chainTickAtSqrtRatio = async (sqrtPriceX96: bigint) =>
    (await Pool.tests.getTickAtSqrtRatio({ initialFields: poolFields, args: { sqrtPriceX96 } })).returns

  const ticks = [MIN_TICK, MIN_TICK + 1n, -299_336n, -276_000n, -1n, 0n, 1n, 23_027n, 276_324n, MAX_TICK - 1n, MAX_TICK]

  test('getSqrtRatioAtTick', async () => {
    for (const tick of ticks) {
      expect(TickUtils.getSqrtRatioAtTick(tick), `tick ${tick}`).toBe(await chainSqrtRatioAtTick(tick))
    }
  })

  test('getTickAtSqrtRatio around tick boundaries', async () => {
    const sqrtPrices = [MIN_SQRT_RATIO, MAX_SQRT_RATIO - 1n]
    for (const tick of ticks.filter((t) => t > MIN_TICK && t < MAX_TICK)) {
      const sqrt = await chainSqrtRatioAtTick(tick)
      sqrtPrices.push(sqrt - 1n, sqrt, sqrt + 1n)
    }
    for (const sqrtPriceX96 of sqrtPrices) {
      expect(TickUtils.getTickAtSqrtRatio(sqrtPriceX96), `sqrtPriceX96 ${sqrtPriceX96}`).toBe(
        await chainTickAtSqrtRatio(sqrtPriceX96)
      )
    }
  })

  test('getLiquidityFromAmounts around tickLower and tickUpper', async () => {
    const tickLower = -276_000n
    const tickUpper = tickLower + 600n
    const sqrtA = await chainSqrtRatioAtTick(tickLower)
    const sqrtB = await chainSqrtRatioAtTick(tickUpper)
    const amount = 10n ** 18n
    const deposits = [
      [amount, 0n],
      [0n, amount],
      [amount, amount]
    ]
    const prices = [sqrtA - 1n, sqrtA, sqrtA + 1n, (sqrtA + sqrtB) / 2n, sqrtB - 1n, sqrtB, sqrtB + 1n]

    for (const sqrtRatioX96 of prices) {
      for (const [amount0, amount1] of deposits) {
        const { returns } = await LiquidityAmountsTest.tests.getLiquidityForAmounts({
          args: { sqrtRatioX96, sqrtRatioAX96: sqrtA, sqrtRatioBX96: sqrtB, amount0, amount1 }
        })
        const sdk = ClmmLiquidityUtils.getLiquidityFromAmounts(sqrtRatioX96, sqrtA, sqrtB, amount0, amount1)
        expect(sdk, `sqrtRatioX96 ${sqrtRatioX96}, amounts [${amount0}, ${amount1}]`).toBe(returns)
      }
    }
  })
})
