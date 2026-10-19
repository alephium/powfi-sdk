import type { PoolInstance } from 'clmm/artifacts/ts'
import {
  SwapWithoutAccount,
  SwapWithoutAccountWithFeeAndUsdtRedirect,
  SwapWithoutAccountWithUsdtRedirect
} from 'clmm/artifacts/ts'
import { ALPH_TOKEN_ID, DUST_AMOUNT, ONE_ALPH } from '@alephium/web3'
import type { SignExecuteScriptTxResult } from '@alephium/web3'
import { ClmmModule } from '../../src/clmm/clmm'
import type { ClmmSwapRequest } from '../../src/clmm/types'
import type { Powfi } from '../../src/powfi'

const SPECIAL_SENDER = '1H8Ba1kv9WHfeXtySgUVecE7o4DqfhGorErvB92dEJ5Yf'
const REDIRECT_RECIPIENT = '16j6oMwCc768CSjXst5ftHwyu7gUn6PvCX7YVvAQWWbZ2'
const USDT_TOKEN_ID = '556d9582463fe44fbd108aedc9f409f69086dc78d994b88ea6c9e65f8bf98e00'
const OTHER_TOKEN_ID = '11'.repeat(32)
const result = {} as SignExecuteScriptTxResult

function createModule(sender: string) {
  const getSelectedAccount = vi.fn().mockResolvedValue({ address: sender })
  const module = new ClmmModule({
    network: { id: 'mainnet' },
    signer: { getSelectedAccount }
  } as unknown as Powfi)

  vi.spyOn(module, 'getPool').mockReturnValue({
    contractId: '00'.repeat(32),
    fetchState: vi.fn().mockResolvedValue({
      fields: {
        token0: ALPH_TOKEN_ID,
        slot0: { sqrtPriceX96: 2n ** 96n }
      }
    })
  } as unknown as PoolInstance)

  return module
}

const request = (overrides: Partial<ClmmSwapRequest> = {}): ClmmSwapRequest => ({
  token0: ALPH_TOKEN_ID,
  token1: USDT_TOKEN_ID,
  amount: ONE_ALPH,
  amountIn: ONE_ALPH,
  slippage: 50n,
  routePlan: [3n],
  ...overrides
})
describe('CLMM USDT redirect script selection', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses the redirect script and an extra dust output for the configured sender', async () => {
    const redirected = vi.spyOn(SwapWithoutAccountWithUsdtRedirect, 'execute').mockResolvedValue(result)
    const regular = vi.spyOn(SwapWithoutAccount, 'execute').mockResolvedValue(result)

    await createModule(SPECIAL_SENDER).swap(request({ token1: USDT_TOKEN_ID.toUpperCase() }))

    expect(redirected).toHaveBeenCalledOnce()
    expect(redirected.mock.calls[0][0].attoAlphAmount).toBe(DUST_AMOUNT * 3n)
    expect(regular).not.toHaveBeenCalled()
  })

  it('keeps using the existing script for every other sender', async () => {
    const redirected = vi.spyOn(SwapWithoutAccountWithUsdtRedirect, 'execute').mockResolvedValue(result)
    const regular = vi.spyOn(SwapWithoutAccount, 'execute').mockResolvedValue(result)

    await createModule(REDIRECT_RECIPIENT).swap(request())

    expect(regular).toHaveBeenCalledOnce()
    expect(regular.mock.calls[0][0].attoAlphAmount).toBe(DUST_AMOUNT * 2n)
    expect(redirected).not.toHaveBeenCalled()
  })

  it('keeps using the existing script for other output tokens', async () => {
    const redirected = vi.spyOn(SwapWithoutAccountWithUsdtRedirect, 'execute').mockResolvedValue(result)
    const regular = vi.spyOn(SwapWithoutAccount, 'execute').mockResolvedValue(result)

    await createModule(SPECIAL_SENDER).swap(request({ token1: OTHER_TOKEN_ID }))

    expect(regular).toHaveBeenCalledOnce()
    expect(redirected).not.toHaveBeenCalled()
  })

  it('uses the redirect script for exact-output swaps', async () => {
    const redirected = vi.spyOn(SwapWithoutAccountWithUsdtRedirect, 'execute').mockResolvedValue(result)

    await createModule(SPECIAL_SENDER).swap(request({ amount: -1n }))

    expect(redirected).toHaveBeenCalledOnce()
    expect(redirected.mock.calls[0][0].initialFields.amountSpecified).toBe(-1n)
  })

  it('uses the fee-aware redirect script when an integrator fee is present', async () => {
    const redirected = vi.spyOn(SwapWithoutAccountWithFeeAndUsdtRedirect, 'execute').mockResolvedValue(result)

    await createModule(SPECIAL_SENDER).swap(
      request({
        fee: DUST_AMOUNT,
        feeRecipient: REDIRECT_RECIPIENT
      })
    )

    expect(redirected).toHaveBeenCalledOnce()
    expect(redirected.mock.calls[0][0].attoAlphAmount).toBe(DUST_AMOUNT * 3n)
  })
})
