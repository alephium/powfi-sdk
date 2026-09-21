import type { PoolInstance } from 'clmm/artifacts/ts'
import type { SignerProvider } from '@alephium/web3'
import { ALPH_TOKEN_ID, DUST_AMOUNT, ONE_ALPH, web3 } from '@alephium/web3'
import { getSigners } from '@alephium/web3-test'
import { PrivateKeyWallet } from '@alephium/web3-wallet'
import { UNLIMITED_AMOUNT } from '../../../src'
import { Fixture, getBalances } from './helpers'

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch)

describe('CLMM Swap with an integrator fee', () => {
  let fixture: Fixture
  let trader: SignerProvider
  let traderAddress: string
  let configIndex: bigint
  let pool: PoolInstance
  let tokenIds: string[]

  const fee = ONE_ALPH / 100n

  beforeAll(async () => {
    fixture = await Fixture.create()
    const signers = await getSigners(2, 3_000n * ONE_ALPH)
    const lp = signers[0]
    trader = signers[1]
    traderAddress = (await trader.getSelectedAccount()).address
    tokenIds = [fixture.tokenId0, fixture.tokenId1]

    await fixture.transferToken(fixture.tokenId0, 2_000n * ONE_ALPH, lp)
    await fixture.transferToken(fixture.tokenId1, 2_000n * ONE_ALPH, lp)
    await fixture.transferToken(fixture.tokenId0, 1_000n * ONE_ALPH, trader)
    await fixture.transferToken(fixture.tokenId1, 1_000n * ONE_ALPH, trader)

    const setup = await fixture.setupPool(1n, 3_000n, 0n)
    configIndex = setup.configIndex
    pool = setup.pool

    const sqrtPriceCurrent = (await pool.fetchState()).fields.slot0.sqrtPriceX96
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1)
    await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: { tickLower, tickUpper },
      amount0Desired: 100n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT
    })
  }, 120000)

  beforeEach(() => {
    fixture.powfi.signer = trader
  })

  const freshRecipient = () => PrivateKeyWallet.Random(0).address

  const snapshot = async (feeRecipient: string) => ({
    trader: await getBalances(traderAddress, tokenIds),
    pool: await getBalances(pool.address, tokenIds),
    recipient: await getBalances(feeRecipient, tokenIds)
  })

  type Snapshot = Awaited<ReturnType<typeof snapshot>>
  const delta = (before: Snapshot, after: Snapshot, who: keyof Snapshot, tokenId: string) =>
    after[who].tokens[tokenId] - before[who].tokens[tokenId]

  test('exact-in swap pays the fee on top of the swapped amount', async () => {
    const feeRecipient = freshRecipient()
    const amountIn = 5n * ONE_ALPH
    const expectedOut = await fixture.computeSwapBaseIn(configIndex, fixture.tokenId0, fixture.tokenId1, amountIn)

    const before = await snapshot(feeRecipient)
    expect(before.recipient.tokens[fixture.tokenId0]).toBe(0n)

    await fixture.powfi.clmm.swap({
      token0: fixture.tokenId0,
      token1: fixture.tokenId1,
      amount: amountIn,
      amountIn,
      routePlan: [configIndex],
      slippage: 30n,
      fee,
      feeRecipient
    })

    const after = await snapshot(feeRecipient)
    expect(delta(before, after, 'trader', fixture.tokenId0)).toBe(-(amountIn + fee))
    expect(delta(before, after, 'pool', fixture.tokenId0)).toBe(amountIn)
    expect(delta(before, after, 'recipient', fixture.tokenId0)).toBe(fee)
    // expectedOut is negative
    expect(delta(before, after, 'trader', fixture.tokenId1)).toBe(-expectedOut)
  }, 60000)

  test('exact-out swap without a fee', async () => {
    const feeRecipient = freshRecipient()
    const exactOut = 2n * ONE_ALPH
    const amountIn = 10n * ONE_ALPH

    const before = await snapshot(feeRecipient)

    await fixture.powfi.clmm.swap({
      token0: fixture.tokenId0,
      token1: fixture.tokenId1,
      amount: -exactOut,
      amountIn: amountIn,
      routePlan: [configIndex],
      slippage: 300n
    })

    const after = await snapshot(feeRecipient)
    const actualIn = delta(before, after, 'pool', fixture.tokenId0)

    expect(delta(before, after, 'trader', fixture.tokenId1)).toBe(exactOut)
    expect(delta(before, after, 'pool', fixture.tokenId1)).toBe(-exactOut)
    // No fee was taken
    expect(delta(before, after, 'trader', fixture.tokenId0)).toBe(-actualIn)
  }, 60000)

  test('exact-out swap takes the fee before remaining tokens are approved for swap', async () => {
    const feeRecipient = freshRecipient()
    const exactOut = 2n * ONE_ALPH
    const amountIn = 10n * ONE_ALPH

    const before = await snapshot(feeRecipient)
    expect(before.recipient.tokens[fixture.tokenId0]).toBe(0n)

    await fixture.powfi.clmm.swap({
      token0: fixture.tokenId0,
      token1: fixture.tokenId1,
      amount: -exactOut,
      amountIn: amountIn,
      routePlan: [configIndex],
      slippage: 300n,
      fee,
      feeRecipient
    })

    const after = await snapshot(feeRecipient)
    const actualIn = delta(before, after, 'pool', fixture.tokenId0)

    expect(delta(before, after, 'trader', fixture.tokenId1)).toBe(exactOut)
    expect(delta(before, after, 'recipient', fixture.tokenId0)).toBe(fee)
    expect(delta(before, after, 'trader', fixture.tokenId0)).toBe(-(actualIn + fee))
  }, 60000)
})

describe('CLMM Swap with an ALPH fee', () => {
  let fixture: Fixture
  let trader: SignerProvider
  let traderAddress: string
  let configIndex: bigint
  let pool: PoolInstance
  let tokenIds: string[]

  const fee = DUST_AMOUNT

  beforeAll(async () => {
    fixture = await Fixture.create(true) // token0 is ALPH
    const signers = await getSigners(2, 3_000n * ONE_ALPH)
    const lp = signers[0]
    trader = signers[1]
    traderAddress = (await trader.getSelectedAccount()).address
    tokenIds = [fixture.tokenId0, fixture.tokenId1]

    await fixture.transferToken(fixture.tokenId1, 2_000n * ONE_ALPH, lp)
    await fixture.transferToken(fixture.tokenId1, 1_000n * ONE_ALPH, trader)

    const setup = await fixture.setupPool(1n, 3_000n, 0n)
    configIndex = setup.configIndex
    pool = setup.pool

    const sqrtPriceCurrent = (await pool.fetchState()).fields.slot0.sqrtPriceX96
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1)
    await fixture.addLiquidity(lp, configIndex, 100n * ONE_ALPH, 1_000n * ONE_ALPH, 0n, tickLower, tickUpper)
  }, 120000)

  beforeEach(() => {
    fixture.powfi.signer = trader
  })

  test('swap when the token in and fee are in ALPH', async () => {
    expect(fixture.tokenId0).toBe(ALPH_TOKEN_ID)
    const feeRecipient = PrivateKeyWallet.Random(0).address
    const amountIn = 5n * ONE_ALPH
    const expectedOut = await fixture.computeSwapBaseIn(configIndex, fixture.tokenId0, fixture.tokenId1, amountIn)

    const traderBefore = await getBalances(traderAddress, tokenIds)
    const poolBefore = await getBalances(pool.address, tokenIds)
    const recipientBefore = await getBalances(feeRecipient, tokenIds)
    expect(recipientBefore.alph).toBe(0n)

    await fixture.powfi.clmm.swap({
      token0: fixture.tokenId0,
      token1: fixture.tokenId1,
      amount: amountIn,
      amountIn: amountIn,
      routePlan: [configIndex],
      slippage: 30n,
      fee,
      feeRecipient
    })

    const traderAfter = await getBalances(traderAddress, tokenIds)
    const poolAfter = await getBalances(pool.address, tokenIds)
    const recipientAfter = await getBalances(feeRecipient, tokenIds)

    expect(recipientAfter.alph - recipientBefore.alph).toBe(fee)
    expect(poolAfter.alph - poolBefore.alph).toBe(amountIn)
    expect(traderAfter.tokens[fixture.tokenId1] - traderBefore.tokens[fixture.tokenId1]).toBe(-expectedOut)
    expect(traderAfter.alph - traderBefore.alph).toBeLessThan(-(amountIn + fee))
  }, 60000)
})
