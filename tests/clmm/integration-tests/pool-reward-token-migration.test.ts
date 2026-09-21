import { ONE_ALPH, web3 } from '@alephium/web3'
import { mintToken } from '@alephium/web3-test'
import { Fixture, getBalances } from './helpers'

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch)

describe('CLMM pool reward-token migration', () => {
  it('preserves the pool and enables its empty external reward slot', async () => {
    const fixture = await Fixture.create()
    const configIndex = await fixture.createConfigIndex(1n, 3_000n, 0n, '')
    const pool = await fixture.createPoolWithInitialLiquidity(configIndex, 100n * ONE_ALPH, 1_000n * ONE_ALPH)
    const owner = await fixture.deployer.getSelectedAccount()
    const { tokenId: rewardToken } = await mintToken(owner.address, 10n * ONE_ALPH)
    const before = await pool.fetchState()

    await fixture.powfi.clmm.migratePoolRewardToken(fixture.tokenId0, fixture.tokenId1, configIndex, rewardToken)

    const after = await pool.fetchState()
    expect(after.asset).toEqual(before.asset)
    expect(after.fields).toEqual({ ...before.fields, token2: rewardToken })

    const rewardAmount = ONE_ALPH
    const now = BigInt(Date.now())
    await fixture.powfi.clmm.setRewardParams({
      token0: fixture.tokenId0,
      token1: fixture.tokenId1,
      configIndex,
      rewardToken,
      payer: owner.address,
      amount: rewardAmount,
      openTime: now,
      endTime: now + 86_400_000n
    })

    const funded = await pool.fetchState()
    const balances = await getBalances(pool.address, [rewardToken])
    expect(funded.fields.rewardInfos[2].amount).toBe(rewardAmount)
    expect(balances.tokens[rewardToken]).toBe(rewardAmount)
  })
})
