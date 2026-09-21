import type { SignerProvider } from '@alephium/web3'
import { ALPH_TOKEN_ID, DUST_AMOUNT, ONE_ALPH, web3 } from '@alephium/web3'
import { PrivateKeyWallet } from '@alephium/web3-wallet'
import { CpmmModule } from '../../../src/cpmm/cpmm'
import { InsufficientBalanceError } from '../../../src/common/error'
import type { CpmmSwapQuote } from '../../../src/cpmm/types'
import { Fixture, getBalances } from './helpers'

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch)

const freshRecipient = () => PrivateKeyWallet.Random(0).address

describe('CPMM Swap', () => {
  let fixture: Fixture
  let trader: SignerProvider
  let traderAddress: string
  let poolAddress: string
  let tokenIds: string[]

  const reserve = 1_000n * ONE_ALPH
  const swapIn = ONE_ALPH
  const fee = ONE_ALPH / 100n

  beforeAll(async () => {
    fixture = await Fixture.create()
    trader = fixture.deployer
    traderAddress = (await trader.getSelectedAccount()).address
    tokenIds = [fixture.tokenId0, fixture.tokenId1]
    await fixture.createPool(reserve, reserve)
    poolAddress = fixture.powfi.cpmm.getPoolAddress(fixture.tokenId0, fixture.tokenId1)
  }, 120000)

  const getQuote = async (params: { amountIn?: bigint; amountOut?: bigint }): Promise<CpmmSwapQuote> => {
    const state = await fixture.powfi.cpmm.getPoolState(fixture.tokenId0, fixture.tokenId1)
    return CpmmModule.computeSwapAmount({
      state,
      tokenInId: fixture.tokenId0,
      tokenOutId: fixture.tokenId1,
      slippageBps: 100n,
      ...params
    })
  }

  const snapshot = async (feeRecipient: string) => ({
    trader: await getBalances(traderAddress, tokenIds),
    pool: await getBalances(poolAddress, tokenIds),
    recipient: await getBalances(feeRecipient, tokenIds)
  })

  type Snapshot = Awaited<ReturnType<typeof snapshot>>
  const delta = (before: Snapshot, after: Snapshot, who: keyof Snapshot, tokenId: string) =>
    after[who].tokens[tokenId] - before[who].tokens[tokenId]

  test('exact-in swap without fee', async () => {
    const recipient = freshRecipient()
    const quote = await getQuote({ amountIn: swapIn })
    const before = await snapshot(recipient)

    await fixture.powfi.cpmm.swap({
      tokenInId: fixture.tokenId0,
      tokenOutId: fixture.tokenId1,
      amountIn: swapIn,
      slippageBps: 100n,
      sender: traderAddress
    })

    const after = await snapshot(recipient)
    expect(delta(before, after, 'trader', fixture.tokenId0)).toBe(-swapIn)
    expect(delta(before, after, 'trader', fixture.tokenId1)).toBe(quote.tokenOutAmount)
    expect(delta(before, after, 'pool', fixture.tokenId0)).toBe(swapIn)
    expect(delta(before, after, 'pool', fixture.tokenId1)).toBe(-quote.tokenOutAmount)
  }, 60000)

  test('exact-in swap with fee', async () => {
    const feeRecipient = freshRecipient()
    const quote = await getQuote({ amountIn: swapIn })
    const before = await snapshot(feeRecipient)
    expect(before.recipient.tokens[fixture.tokenId0]).toBe(0n)

    await fixture.powfi.cpmm.swap({
      tokenInId: fixture.tokenId0,
      tokenOutId: fixture.tokenId1,
      amountIn: swapIn,
      slippageBps: 100n,
      sender: traderAddress,
      fee,
      feeRecipient
    })

    const after = await snapshot(feeRecipient)

    expect(delta(before, after, 'trader', fixture.tokenId0)).toBe(-(swapIn + fee))
    expect(delta(before, after, 'pool', fixture.tokenId0)).toBe(swapIn)
    expect(delta(before, after, 'recipient', fixture.tokenId0)).toBe(fee)
    // Fee has no impact on the swap
    expect(delta(before, after, 'trader', fixture.tokenId1)).toBe(quote.tokenOutAmount)
  }, 60000)

  test('exact-out swap without fee', async () => {
    const feeRecipient = freshRecipient()
    const exactOut = ONE_ALPH
    const quote = await getQuote({ amountOut: exactOut })
    const before = await snapshot(feeRecipient)

    await fixture.powfi.cpmm.swap({
      tokenInId: fixture.tokenId0,
      tokenOutId: fixture.tokenId1,
      amountOut: exactOut,
      slippageBps: 100n,
      sender: traderAddress
    })

    const after = await snapshot(feeRecipient)
    expect(delta(before, after, 'trader', fixture.tokenId0)).toBe(-quote.tokenInAmount)
    expect(delta(before, after, 'trader', fixture.tokenId1)).toBe(exactOut)
    expect(delta(before, after, 'pool', fixture.tokenId0)).toBe(quote.tokenInAmount)
    expect(delta(before, after, 'pool', fixture.tokenId1)).toBe(-exactOut)
  }, 60000)

  test('exact-out swap with fee', async () => {
    const feeRecipient = freshRecipient()
    const exactOut = ONE_ALPH
    const quote = await getQuote({ amountOut: exactOut })
    const before = await snapshot(feeRecipient)
    expect(before.recipient.tokens[fixture.tokenId0]).toBe(0n)

    await fixture.powfi.cpmm.swap({
      tokenInId: fixture.tokenId0,
      tokenOutId: fixture.tokenId1,
      amountOut: exactOut,
      slippageBps: 100n,
      sender: traderAddress,
      fee,
      feeRecipient
    })

    const after = await snapshot(feeRecipient)
    expect(delta(before, after, 'trader', fixture.tokenId0)).toBe(-(quote.tokenInAmount + fee))
    expect(delta(before, after, 'pool', fixture.tokenId0)).toBe(quote.tokenInAmount)
    expect(delta(before, after, 'recipient', fixture.tokenId0)).toBe(fee)
    expect(delta(before, after, 'trader', fixture.tokenId1)).toBe(exactOut)
  }, 60000)

  test('the balance check accounts for both amount in and fee', async () => {
    const balances = new Map([[fixture.tokenId0, swapIn]])

    await expect(
      fixture.powfi.cpmm.swap(
        {
          tokenInId: fixture.tokenId0,
          tokenOutId: fixture.tokenId1,
          amountIn: swapIn,
          slippageBps: 100n,
          sender: traderAddress,
          fee,
          feeRecipient: freshRecipient()
        },
        balances
      )
    ).rejects.toThrow(InsufficientBalanceError)
  })

  test('rejects a fee without a recipient', async () => {
    await expect(
      fixture.powfi.cpmm.swap({
        tokenInId: fixture.tokenId0,
        tokenOutId: fixture.tokenId1,
        amountIn: swapIn,
        slippageBps: 100n,
        sender: traderAddress,
        fee
      })
    ).rejects.toThrow(/must be provided together/)
  })

  test('rejects a fee recipient equal to the sender', async () => {
    await expect(
      fixture.powfi.cpmm.swap({
        tokenInId: fixture.tokenId0,
        tokenOutId: fixture.tokenId1,
        amountIn: swapIn,
        slippageBps: 100n,
        sender: traderAddress,
        fee,
        feeRecipient: traderAddress
      })
    ).rejects.toThrow(/differ from the sender/)
  })
})

describe('CPMM Swap with an ALPH fee', () => {
  let fixture: Fixture
  let traderAddress: string
  let poolAddress: string
  let tokenIds: string[]

  const reserve = 1_000n * ONE_ALPH
  const swapIn = ONE_ALPH
  const fee = DUST_AMOUNT

  beforeAll(async () => {
    fixture = await Fixture.create(true) // token0 is native ALPH
    traderAddress = (await fixture.deployer.getSelectedAccount()).address
    tokenIds = [fixture.tokenId0, fixture.tokenId1]
    await fixture.createPool(reserve, reserve)
    poolAddress = fixture.powfi.cpmm.getPoolAddress(fixture.tokenId0, fixture.tokenId1)
  }, 120000)

  test('fee is paid in ALPH', async () => {
    expect(fixture.tokenId0).toBe(ALPH_TOKEN_ID)
    const feeRecipient = freshRecipient()

    const state = await fixture.powfi.cpmm.getPoolState(fixture.tokenId0, fixture.tokenId1)
    const quote = CpmmModule.computeSwapAmount({
      state,
      tokenInId: fixture.tokenId0,
      tokenOutId: fixture.tokenId1,
      amountIn: swapIn,
      slippageBps: 100n
    })

    const traderBefore = await getBalances(traderAddress, tokenIds)
    const poolBefore = await getBalances(poolAddress, tokenIds)
    const recipientBefore = await getBalances(feeRecipient, tokenIds)
    expect(recipientBefore.alph).toBe(0n)

    await fixture.powfi.cpmm.swap({
      tokenInId: fixture.tokenId0,
      tokenOutId: fixture.tokenId1,
      amountIn: swapIn,
      slippageBps: 100n,
      sender: traderAddress,
      fee,
      feeRecipient
    })

    const traderAfter = await getBalances(traderAddress, tokenIds)
    const poolAfter = await getBalances(poolAddress, tokenIds)
    const recipientAfter = await getBalances(feeRecipient, tokenIds)

    expect(recipientAfter.alph - recipientBefore.alph).toBe(fee)
    expect(poolAfter.alph - poolBefore.alph).toBe(swapIn)
    expect(traderAfter.tokens[fixture.tokenId1] - traderBefore.tokens[fixture.tokenId1]).toBe(quote.tokenOutAmount)
    expect(traderAfter.alph - traderBefore.alph).toBeLessThan(-(swapIn + fee))
  }, 60000)

  test('rejects an ALPH fee below the dust amount', async () => {
    await expect(
      fixture.powfi.cpmm.swap({
        tokenInId: fixture.tokenId0,
        tokenOutId: fixture.tokenId1,
        amountIn: swapIn,
        slippageBps: 100n,
        sender: traderAddress,
        fee: DUST_AMOUNT - 1n,
        feeRecipient: PrivateKeyWallet.Random(0).address
      })
    ).rejects.toThrow(/dust amount/)
  })
})
