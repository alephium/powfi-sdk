import type { SignerProvider } from '@alephium/web3'
import { ONE_ALPH, web3, addressFromContractId } from '@alephium/web3'
import { getSigners, mintToken } from '@alephium/web3-test'
import { Fixture } from './helpers'
import { SwapWithoutAccount } from 'clmm/artifacts/ts'
import { MIN_SQRT_RATIO } from 'clmm/artifacts/ts/constants'
import { PoolUtils } from '../../../src'

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch)

describe('CLMM Multihop Swap Simulation', () => {
  let fixture: Fixture
  let lp: SignerProvider
  let trader: SignerProvider
  let token0: string
  let token1: string
  let token2: string
  let configIndex: bigint
  const tickSpacing = 10n
  const fee = 0n
  const feeProtocol = 0n

  beforeEach(async () => {
    fixture = await Fixture.create()
    const signers = await getSigners(2, 3_000n * ONE_ALPH)
    lp = signers[0]
    trader = signers[1]

    // Mint third token
    const deployerAddress = (await fixture.deployer.getSelectedAccount()).address
    const { tokenId: tokenC } = await mintToken(deployerAddress, 1_000_000n * ONE_ALPH)

    // Sort tokens
    const sorted = [fixture.tokenId0, fixture.tokenId1, tokenC].sort()
    token0 = sorted[0]
    token1 = sorted[1]
    token2 = sorted[2]

    // Transfer balances to LP and Trader
    for (const t of [token0, token1, token2]) {
      if (t === fixture.tokenId0 || t === fixture.tokenId1) {
        await fixture.transferToken(t, 2_000n * ONE_ALPH, lp)
        await fixture.transferToken(t, 1_000n * ONE_ALPH, trader)
      } else {
        // tokenC is owned by deployer, transfer directly
        await fixture.deployer.signAndSubmitTransferTx({
          signerAddress: deployerAddress,
          destinations: [
            {
              address: (await lp.getSelectedAccount()).address,
              attoAlphAmount: ONE_ALPH,
              tokens: [{ id: t, amount: 2_000n * ONE_ALPH }]
            },
            {
              address: (await trader.getSelectedAccount()).address,
              attoAlphAmount: ONE_ALPH,
              tokens: [{ id: t, amount: 1_000n * ONE_ALPH }]
            }
          ]
        })
      }
    }

    // Set up config
    fixture.powfi.signer = fixture.deployer
    configIndex = await fixture.createConfigIndex(tickSpacing, fee, feeProtocol)

    // Deploy Pool 0-1
    await fixture.powfi.clmm.createPool(
      configIndex,
      token0,
      token1,
      0n, // current tick
      100n * ONE_ALPH,
      100n * ONE_ALPH,
      -100n, // tickLower
      100n // tickUpper
    )

    // Deploy Pool 1-2
    await fixture.powfi.clmm.createPool(
      configIndex,
      token1,
      token2,
      0n, // current tick
      100n * ONE_ALPH,
      100n * ONE_ALPH,
      -100n, // tickLower
      100n // tickUpper
    )
  }, 120000)

  test('SDK simulateSwap multi-hop', async () => {
    const pool3Id = fixture.powfi.clmm.getPoolId(token1, token2, configIndex)
    const pool3Address = addressFromContractId(pool3Id)

    // Build swap data path: token2 + configIndex in 2 bytes
    const swapData = fixture.powfi.clmm.buildSwapPath(token2, configIndex)

    fixture.powfi.signer = trader
    const amount = 10n

    // Run multi-hop swap simulation via SDK
    const quote = await fixture.powfi.clmm.simulateSwap({
      configIndex,
      token0,
      token1,
      zeroForOne: true,
      amount,
      data: swapData,
      interestedContracts: [pool3Address]
    })

    // Verify simulation result returns the correct properties
    expect(quote.sqrtPriceX96).toBeDefined()
    expect(quote.baseSqrtPriceX96).toBeDefined()
    expect(quote.rows.length).toBeGreaterThanOrEqual(1)
  }, 60000)

  test('SDK offlineSwap multi-hop', async () => {
    fixture.powfi.signer = trader
    const amount = 10n

    // 1. First Hop (Pool 1) Simulation & Offline Swap
    const quote1 = await fixture.powfi.clmm.simulateSwap({
      configIndex,
      token0,
      token1,
      zeroForOne: true,
      amount
    })
    const offlineOut1 = PoolUtils.offlineSwap(quote1, amount, quote1.sqrtPriceX96)

    // Compare offline swap output with on-chain simulation return
    const pool1 = fixture.powfi.clmm.getPool(token0, token1, configIndex)
    const result1 = await pool1.view.simulateSwap({
      args: {
        amountSpecified: amount,
        zeroForOne: true,
        data: '',
        maxSteps: 500n
      }
    })
    expect(offlineOut1).toEqual(result1.returns[1])

    // 2. Second Hop (Pool 2) Simulation & Offline Swap
    const amount1 = -offlineOut1
    const quote2 = await fixture.powfi.clmm.simulateSwap({
      configIndex,
      token0: token1,
      token1: token2,
      zeroForOne: true,
      amount: amount1
    })
    const offlineOut2 = PoolUtils.offlineSwap(quote2, amount1, quote2.sqrtPriceX96)

    // Compare offline swap output with on-chain simulation return
    const pool2 = fixture.powfi.clmm.getPool(token1, token2, configIndex)
    const result2 = await pool2.view.simulateSwap({
      args: {
        amountSpecified: amount1,
        zeroForOne: true,
        data: '',
        maxSteps: 500n
      }
    })
    expect(offlineOut2).toEqual(result2.returns[1])
  }, 60000)

  test('SDK swap transaction multi-hop', async () => {
    const pool1Id = fixture.powfi.clmm.getPoolId(token0, token1, configIndex)
    const swapData = fixture.powfi.clmm.buildSwapPath(token2, configIndex)

    fixture.powfi.signer = trader
    const amount = 10n

    // Get expected output from offline swap
    const quote1 = await fixture.powfi.clmm.simulateSwap({
      configIndex,
      token0,
      token1,
      zeroForOne: true,
      amount
    })
    const offlineOut1 = PoolUtils.offlineSwap(quote1, amount, quote1.sqrtPriceX96)

    const amount1 = -offlineOut1
    const quote2 = await fixture.powfi.clmm.simulateSwap({
      configIndex,
      token0: token1,
      token1: token2,
      zeroForOne: true,
      amount: amount1
    })
    const offlineOut2 = PoolUtils.offlineSwap(quote2, amount1, quote2.sqrtPriceX96)

    // Check balances before
    const traderAddress = (await trader.getSelectedAccount()).address
    const getTraderBalances = async () => {
      const balance = await web3.getCurrentNodeProvider().addresses.getAddressesAddressBalance(traderAddress)
      const getAmount = (id: string) => BigInt(balance.tokenBalances?.find((t) => t.id === id)?.amount ?? '0')
      return {
        token0: getAmount(token0),
        token1: getAmount(token1),
        token2: getAmount(token2)
      }
    }

    const before = await getTraderBalances()

    // Execute multi-hop swap transaction
    await SwapWithoutAccount.execute({
      signer: trader,
      initialFields: {
        pool: pool1Id,
        tokenIn: token0,
        tokenOut: token2,
        zeroForOne: true,
        amountSpecified: amount,
        sqrtPriceLimitX96: MIN_SQRT_RATIO + 1n,
        data: swapData
      },
      tokens: [{ id: token0, amount }],
      attoAlphAmount: ONE_ALPH * 2n
    })

    // Check balances after
    const after = await getTraderBalances()

    // Verify balance changes match offline swap outputs
    expect(after.token0 - before.token0).toEqual(-amount)
    expect(after.token1 - before.token1).toEqual(0n)
    expect(after.token2 - before.token2).toEqual(-offlineOut2)
  }, 60000)
})
