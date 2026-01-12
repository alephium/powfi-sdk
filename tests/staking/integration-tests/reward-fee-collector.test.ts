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
})
