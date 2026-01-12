import type { SignerProvider } from '@alephium/web3'
import { MINIMAL_CONTRACT_DEPOSIT, ONE_ALPH, web3 } from '@alephium/web3'
import { getSigner } from '@alephium/web3-test'
import { UNLIMITED_AMOUNT } from '../../../src'
import { PoolNotFoundError } from '../../../src/common'
import { Fixture, getBalances, timeout } from './helpers'
import { DistributorVault, RewardFeeCollector } from 'staking/artifacts/ts'

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch)

describe('CLMM Managing Positions', () => {
  let fixture: Fixture
  let lp: SignerProvider

  beforeEach(async () => {
    fixture = await Fixture.create()
    lp = await getSigner(20n * ONE_ALPH)
    await fixture.transferToken(fixture.tokenId0, 2_000n * ONE_ALPH, lp)
    await fixture.transferToken(fixture.tokenId1, 2_000n * ONE_ALPH, lp)
  })

  test('collecting with zero liquidity does not change balances or pool liquidity', async () => {
    const { configIndex, pool } = await fixture.setupPool()
    const poolState = await pool.fetchState()
    const sqrtPriceCurrent = poolState.fields.slot0.sqrtPriceX96
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1)

    await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: { tickLower, tickUpper },
      amount0Desired: 50n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT
    })

    const tokenIds = [fixture.tokenId0, fixture.tokenId1]
    const lpAddr = (await lp.getSelectedAccount()).address
    const beforeLp = await getBalances(lpAddr, tokenIds)
    const beforePool = await getBalances(pool.address, tokenIds)
    const beforeState = await pool.fetchState()

    await fixture.collectTokens(lp, configIndex, tickLower, tickUpper, UNLIMITED_AMOUNT, UNLIMITED_AMOUNT, 0n)

    const afterLp = await getBalances(lpAddr, tokenIds)
    const afterPool = await getBalances(pool.address, tokenIds)
    const afterState = await pool.fetchState()

    expect(afterLp.tokens[fixture.tokenId0] - beforeLp.tokens[fixture.tokenId0]).toBe(0n)
    expect(afterLp.tokens[fixture.tokenId1] - beforeLp.tokens[fixture.tokenId1]).toBe(0n)
    expect(afterPool.tokens[fixture.tokenId0] - beforePool.tokens[fixture.tokenId0]).toBe(0n)
    expect(afterPool.tokens[fixture.tokenId1] - beforePool.tokens[fixture.tokenId1]).toBe(0n)
    expect(afterState.fields.liquidity - beforeState.fields.liquidity).toBe(0n)
  })

  test('collecting accrued fees without burning liquidity', async () => {
    const { configIndex, pool } = await fixture.setupPool()
    const poolState = await pool.fetchState()
    const sqrtPriceCurrent = poolState.fields.slot0.sqrtPriceX96
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1)

    await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: { tickLower, tickUpper },
      amount0Desired: 80n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT
    })

    // Generate fees: trader swaps token0 -> token1
    await fixture.swap(fixture.deployer, configIndex, 10n * ONE_ALPH, 300)

    const tokenIds = [fixture.tokenId0, fixture.tokenId1]
    const lpAddr = (await lp.getSelectedAccount()).address
    const beforeLp = await getBalances(lpAddr, tokenIds)
    const beforePool = await getBalances(pool.address, tokenIds)
    const beforeState = await pool.fetchState()

    await fixture.collectTokens(lp, configIndex, tickLower, tickUpper, UNLIMITED_AMOUNT, UNLIMITED_AMOUNT, 0n)

    const afterLp = await getBalances(lpAddr, tokenIds)
    const afterPool = await getBalances(pool.address, tokenIds)
    const afterState = await pool.fetchState()

    const deltaLp0 = afterLp.tokens[fixture.tokenId0] - beforeLp.tokens[fixture.tokenId0]
    const deltaLp1 = afterLp.tokens[fixture.tokenId1] - beforeLp.tokens[fixture.tokenId1]
    const deltaPool0 = afterPool.tokens[fixture.tokenId0] - beforePool.tokens[fixture.tokenId0]
    const deltaPool1 = afterPool.tokens[fixture.tokenId1] - beforePool.tokens[fixture.tokenId1]

    expect(deltaLp0).toBeGreaterThan(0n)
    expect(deltaLp1).toBe(0n)
    expect(deltaPool0).toBe(-deltaLp0)
    expect(deltaPool1).toBe(0n)
    expect(afterState.fields.liquidity - beforeState.fields.liquidity).toBe(0n)
  })

  test('collecting accrued fees + destroy position', async () => {
    const { configIndex, pool } = await fixture.setupPool()
    const poolState = await pool.fetchState()
    const sqrtPriceCurrent = poolState.fields.slot0.sqrtPriceX96
    const { tickLower, tickUpper } = fixture.buildRange(sqrtPriceCurrent, 1n, 0.9, 1.1)

    await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent,
      range: { tickLower, tickUpper },
      amount0Desired: 80n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT
    })

    // Generate fees: trader swaps token0 -> token1
    await fixture.swap(fixture.deployer, configIndex, 10n * ONE_ALPH, 300)

    // const tokenIds = [fixture.tokenId0, fixture.tokenId1]
    const lpAddr = (await lp.getSelectedAccount()).address
    // const beforeLp = await getBalances(lpAddr, tokenIds)
    // const beforePool = await getBalances(pool.address, tokenIds)
    const beforeState = await pool.fetchState()
    const liquidity = beforeState.fields.liquidity - poolState.fields.liquidity

    const posId = fixture.powfi.clmm.getPositionId(pool.contractId, lpAddr, tickLower, tickUpper)
    const beforeLp2 = await getBalances(lpAddr, [posId])
    expect(beforeLp2.tokens[posId]).toBe(1n)
    await fixture.collectTokens(lp, configIndex, tickLower, tickUpper, UNLIMITED_AMOUNT, UNLIMITED_AMOUNT, liquidity)

    const afterLp = await getBalances(lpAddr, [posId])
    expect(afterLp.tokens[posId]).toBe(0n)

    await fixture.addRangePosition({
      lp,
      pool,
      configIndex,
      sqrtPriceCurrent: beforeState.fields.slot0.sqrtPriceX96,
      range: { tickLower, tickUpper },
      amount0Desired: 80n * ONE_ALPH,
      amount1Desired: UNLIMITED_AMOUNT
    })

    const afterLp2 = await getBalances(lpAddr, [posId])
    expect(afterLp2.tokens[posId]).toBe(1n)
  })

  test('findBestRoute throws PoolNotFoundError for non-existent pool', async () => {
    await expect(fixture.powfi.clmm.findBestRoute('invalid-token-0', 'invalid-token-1')).rejects.toThrow(
      PoolNotFoundError
    )

    await expect(fixture.powfi.clmm.findBestRoute('invalid-token-0', 'invalid-token-1')).rejects.toThrow(
      'No concentrated liquidity pool found for token pair'
    )
  })

  test('collecting protocol fees from factory', async () => {
    const feeProtocol = 4n // 1/4 of trading fees
    const { configIndex, pool } = await fixture.setupPool(1n, 3000n, feeProtocol)
    const poolState = await pool.fetchState()
    const sqrtPriceCurrent = poolState.fields.slot0.sqrtPriceX96
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

    // Generate fees
    fixture.powfi.signer = fixture.deployer
    await fixture.swap(fixture.deployer, configIndex, 10n * ONE_ALPH, 300)

    const poolStateAfterSwap = await pool.fetchState()
    expect(poolStateAfterSwap.fields.protocolFees.token0).toBeGreaterThan(0n)

    const deployer = fixture.deployer
    const deployerAddress = (await deployer.getSelectedAccount()).address
    const distributorVaultTemplate = (await DistributorVault.deployTemplate(deployer)).contractInstance
    const { contractInstance: rewardCollector } = await RewardFeeCollector.deploy(deployer, {
      initialFields: {
        owner: deployerAddress,
        xAlph: fixture.tokenId1,
        distributorVaultTemplateId: distributorVaultTemplate.contractId,
        lastUpdate: 0n,
        rewardRate: (1n << 256n) - 1n,
        burnRate: 0n
      },
      initialAttoAlphAmount: MINIMAL_CONTRACT_DEPOSIT + 1n * ONE_ALPH
    })
    fixture.powfi.staking.setConfig({
      ...fixture.powfi.staking.getConfig(),
      feeCollectorId: rewardCollector.contractId
    })
    await fixture.powfi.staking.enableToken(fixture.tokenId0)
    await fixture.powfi.staking.enableToken(fixture.tokenId1)
    await timeout(1000)
    await fixture.powfi.clmm.setFeeCollector()
    await fixture.powfi.clmm.collectProtocolFees({
      token0: fixture.tokenId0,
      token1: fixture.tokenId1,
      configIndex
    })

    const poolStateAfterCollect = await pool.fetchState()
    expect(poolStateAfterCollect.fields.protocolFees.token0).toBe(0n)
  })
})
