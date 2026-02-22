import { ONE_ALPH, web3, groupOfAddress } from '@alephium/web3';
import { getSigner } from '@alephium/web3-test';
import { TickUtils } from '../../../src/clmm/tick';
import { Fixture } from './helpers';


web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch);

describe('CLMM Create Pool', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await Fixture.create();
  });

  test('createPool with groupless signer (cross-group funding)', async () => {
    const grouplessSigner = await getSigner(500n * ONE_ALPH, 1, 'gl-secp256k1');
    const grouplessAccount = await grouplessSigner.getSelectedAccount();
    const grouplessAddr = grouplessAccount.address;

    console.log('Groupless account (group 1):', grouplessAccount);
    expect(groupOfAddress(grouplessAddr)).not.toEqual(0);

    await fixture.transferToken(fixture.tokenId0, 1_000n * ONE_ALPH, grouplessSigner);
    await fixture.transferToken(fixture.tokenId1, 1_000n * ONE_ALPH, grouplessSigner);

    const configIndex = await fixture.createConfigIndex(1n, 3_000n, 0n);

    fixture.powfi.signer = grouplessSigner;

    const amount0 = 10n * ONE_ALPH;
    const amount1 = 100n * ONE_ALPH;
    const price = Number(amount1 / amount0);
    const currentTick = TickUtils.getAlignedTick(price, 18, 18, 1n);
    const tickLower = TickUtils.getAlignedTick(price * 0.9, 18, 18, 1n);
    const tickUpper = TickUtils.getAlignedTick(price * 1.1, 18, 18, 1n);

    const { poolAddress, result } = await fixture.powfi.clmm.createPool(
      configIndex,
      fixture.tokenId0,
      fixture.tokenId1,
      '',
      currentTick,
      amount0,
      amount1,
      tickLower,
      tickUpper
    );

    expect(poolAddress).toBeDefined();
    expect(result.txId).toBeDefined();

    const pool = fixture.powfi.clmm.getPool(fixture.tokenId0, fixture.tokenId1, configIndex);
    const poolState = await pool.fetchState();
    expect(poolState.fields.slot0.sqrtPriceX96).toBeDefined();
  }, 120000);
});
