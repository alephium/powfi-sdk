import { ONE_ALPH, web3 } from '@alephium/web3';
import { getSigner } from '@alephium/web3-test';
import { Fixture } from './helpers';

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch);

describe('getUserStakeVaultInfo with groupless address', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await Fixture.create();
  });

  test('should return correct staking info for staker using grouped address', async () => {
    const staker = await getSigner(1_000n * ONE_ALPH);

    const stakerAddr = (await staker.getSelectedAccount()).address;

    await fixture.stakeAlph(staker, 200n * ONE_ALPH);
    const stakeAmount = 100n * ONE_ALPH;
    await fixture.stakeXAlph(staker, stakeAmount);

    const stakingInfo = await fixture.getUserStakingInfo(stakerAddr);
    expect(stakingInfo.amount).toBe(stakeAmount);
  }, 120000);

  test('should return correct staking info for staker using groupless address', async () => {
    const staker = await getSigner(1_000n * ONE_ALPH, 1, 'gl-secp256k1');
    const stakerAddr = (await staker.getSelectedAccount()).address;

    await fixture.stakeAlph(staker, 200n * ONE_ALPH);
    const stakeAmount = 100n * ONE_ALPH;
    await fixture.stakeXAlph(staker, stakeAmount);

    const stakingInfo = await fixture.getUserStakingInfo(stakerAddr);
    expect(stakingInfo.amount).toBe(stakeAmount);
  }, 120000);
});
