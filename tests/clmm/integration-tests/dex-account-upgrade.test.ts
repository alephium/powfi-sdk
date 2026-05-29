import { ONE_ALPH, addressFromContractId } from '@alephium/web3'
import { getSigners } from '@alephium/web3-test'
import { DexAccount, DexAccountRoot } from 'clmm/artifacts/ts'
import { Fixture } from './helpers'
import type { DexAccountRootInstance } from 'clmm/artifacts/ts'
import type { SignerProvider } from '@alephium/web3'

describe('DexAccount Upgrade Integration Test', () => {
  let fixture: Fixture
  let owner: SignerProvider
  let ownerAddr: string
  let dexRoot: DexAccountRootInstance
  let newRootCode: string
  let newAccCode: string

  beforeAll(async () => {
    fixture = await Fixture.create()
    owner = fixture.deployer
    ownerAddr = (await owner.getSelectedAccount()).address
    dexRoot = fixture.powfi.clmm.getDexAccountRoot()
    newRootCode = DexAccountRoot.contract.bytecode
    newAccCode = DexAccount.contract.bytecode
    await fixture.powfi.clmm.createDexAccount(ownerAddr)
  })

  it('should upgrade root template', async () => {
    await dexRoot.transact.upgrade({
      signer: owner,
      args: { newCode: newRootCode }
    })
  })

  it('should fail to upgrade root template if caller is not owner', async () => {
    const other = (await getSigners(2))[1]
    await expect(
      dexRoot.transact.upgrade({
        signer: other,
        args: { newCode: newRootCode }
      })
    ).rejects.toThrow()
  })

  it('should upgrade root template using SDK migrateDexAccount', async () => {
    await fixture.powfi.clmm.migrateDexAccount(newRootCode)
  })

  it('should upgrade user account using root contract', async () => {
    const accountId = fixture.powfi.clmm.getDexAccountId(ownerAddr)
    await dexRoot.transact.upgradeDexAccount({
      signer: owner,
      args: { newCode: newAccCode, dexAccount: accountId }
    })
  })

  it('should fail to upgrade user account directly', async () => {
    const accountId = fixture.powfi.clmm.getDexAccountId(ownerAddr)
    const account = DexAccount.at(addressFromContractId(accountId))
    await expect(
      account.transact.upgrade({
        signer: owner,
        args: { newCode: newAccCode }
      })
    ).rejects.toThrow()
  })

  it('should upgrade user account using SDK upgradeUserDexAccount', async () => {
    const tx = await fixture.powfi.clmm.upgradeUserDexAccount(ownerAddr, newAccCode)
    expect(tx.txId).toBeDefined()
  })

  it('should upgrade both root and user account after ownership transfer', async () => {
    const [other] = await getSigners(1, 100n * ONE_ALPH)
    const otherAddr = (await other.getSelectedAccount()).address

    // 1. Create user account for owner
    const accountId = fixture.powfi.clmm.getDexAccountId(ownerAddr)

    // 2. Transfer ownership of root to other
    await dexRoot.transact.updateOwner({
      signer: owner,
      args: { newOwner: otherAddr }
    })

    // 3. Upgrade root using other
    const txRoot = await dexRoot.transact.upgrade({
      signer: other,
      args: { newCode: newRootCode }
    })
    expect(txRoot.txId).toBeDefined()

    // 4. Upgrade user account using other
    const txUser = await dexRoot.transact.upgradeDexAccount({
      signer: other,
      args: { newCode: newAccCode, dexAccount: accountId }
    })
    expect(txUser.txId).toBeDefined()
  })
})
