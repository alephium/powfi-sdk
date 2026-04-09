import type { SignerProvider } from '@alephium/web3'
import { ONE_ALPH, web3 } from '@alephium/web3'
import { getSigner } from '@alephium/web3-test'
import { Fixture } from './helpers'

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch)

describe('getUserStakeVaultInfo with groupless address', () => {
  let fixture: Fixture

  beforeEach(async () => {
    fixture = await Fixture.create()
  })

  test('should return correct staking info for staker using grouped address', async () => {
    const staker = await getSigner(1_000n * ONE_ALPH)
    await testStake(staker)
  }, 120000)

  test('should return correct staking info for staker using groupless address', async () => {
    const staker = await getSigner(1_000n * ONE_ALPH, 1, 'gl-secp256k1')
    await testStake(staker)
  }, 120000)

  test('should return correct staking info for staker using grouped address', async () => {
    const staker = await getSigner(1_000n * ONE_ALPH)
    await testUnstake(staker)
  }, 120000)

  test('should return correct staking info for staker using groupless address', async () => {
    const staker = await getSigner(1_000n * ONE_ALPH, 1, 'gl-secp256k1')
    await testUnstake(staker)
  }, 120000)

  const testStake = async (staker: SignerProvider) => {
    const stakerAddr = (await staker.getSelectedAccount()).address

    await fixture.stakeAlph(staker, 200n * ONE_ALPH)
    const stakeAmount = 100n * ONE_ALPH
    await fixture.stakeXAlph(staker, stakeAmount)

    const stakingInfo = await fixture.getUserStakingInfo(stakerAddr)
    expect(stakingInfo.amount).toBe(stakeAmount)
  }

  const testUnstake = async (staker: SignerProvider) => {
    await testStake(staker)

    const stakerAddr = (await staker.getSelectedAccount()).address

    const unstakeAmount = 50n * ONE_ALPH
    await fixture.startUnstake(staker, unstakeAmount)

    const activeUnstakeVaultIndexes = await fixture.getActiveUnstakeVaultIndexes(staker)
    expect(activeUnstakeVaultIndexes).toHaveLength(1)

    const claimableAmount = await fixture.getClaimableAmount(staker, activeUnstakeVaultIndexes[0])
    expect(claimableAmount).toBeGreaterThan(0n)

    const claimUnstakedResult = await fixture.claimUnstaked(staker, activeUnstakeVaultIndexes[0], claimableAmount)
    expect(claimUnstakedResult).toBeTruthy()

    const unstakeVaultState = await fixture.getUnstakeVaultState(stakerAddr, activeUnstakeVaultIndexes[0])

    expect(unstakeVaultState.totalUnstakeAmount).toBe(unstakeAmount)
    expect(unstakeVaultState.withdrawnAmount).toBe(claimableAmount)
    expect(unstakeVaultState.unstakeStartTime).toBeGreaterThan(0n)
    expect(unstakeVaultState.unstakeDuration).toBeGreaterThan(0n)
  }
})
