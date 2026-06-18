import { getSigners, expectAssertionError } from '@alephium/web3-test'
import { ONE_ALPH, ALPH_TOKEN_ID, addressFromContractId } from '@alephium/web3'
import { Fixture } from './helpers'

describe('SDK RewardFeeCollector Caller Redundancy', () => {
  let fixture: Fixture

  beforeEach(async () => {
    fixture = await Fixture.create()
  })

  test('should fail when called by non-owner', async () => {
    const invalidCallerSigner = (await getSigners(2, 10n * ONE_ALPH))[1]
    const rewardCollectorId = fixture.powfi.staking.getConfig().feeCollectorId
    const rewardCollectorAddress = addressFromContractId(rewardCollectorId)

    fixture.powfi.signer = invalidCallerSigner

    await expectAssertionError(fixture.powfi.staking.setRewardRate(5000n), rewardCollectorAddress, 18)

    await expectAssertionError(fixture.powfi.staking.setBurnRate(10n), rewardCollectorAddress, 18)

    await expectAssertionError(fixture.powfi.staking.enableToken(ALPH_TOKEN_ID), rewardCollectorAddress, 18)
  })

  test('should transfer ownership successfully and be able to transfer it back', async () => {
    const feeCollectorId = fixture.powfi.staking.getConfig().feeCollectorId
    const owner = fixture.deployer
    const ownerAddress = (await owner.getSelectedAccount()).address
    const other = (await getSigners(2))[1]
    const otherAddress = other.address

    // 1. Try to transfer ownership with non-owner signer (invalidCallerSigner)
    fixture.powfi.signer = other
    await expect(fixture.powfi.staking.transferOwnership(otherAddress)).rejects.toThrow()

    // 2. Transfer ownership correctly with owner
    fixture.powfi.signer = owner
    const tx = await fixture.powfi.staking.transferOwnership(otherAddress)
    expect(tx.txId).toBeDefined()

    // Verify ownership has transferred
    const rewardCollector = fixture.powfi.staking.getRewardFeeCollector(feeCollectorId)
    let state = await rewardCollector.fetchState()
    expect(state.fields.owner).toBe(otherAddress)

    // 3. Transfer ownership back
    fixture.powfi.signer = other
    const txBack = await fixture.powfi.staking.transferOwnership(ownerAddress)
    expect(txBack.txId).toBeDefined()

    // Verify ownership has transferred back
    state = await rewardCollector.fetchState()
    expect(state.fields.owner).toBe(ownerAddress)
  })
})
