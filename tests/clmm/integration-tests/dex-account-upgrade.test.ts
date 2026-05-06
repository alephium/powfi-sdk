import { web3, ONE_ALPH, addressFromContractId, binToHex, addressToBytes, DUST_AMOUNT } from '@alephium/web3'
import { getSigners, mintToken } from '@alephium/web3-test'
import { DexAccount } from 'clmm/artifacts/ts'
import { Fixture } from './helpers'
import { DexAccountInstance } from 'clmm/artifacts/ts'
import { SignerProvider } from '@alephium/web3'

describe('DexAccount Upgrade Integration Test', () => {
  let fixture: Fixture
  let owner: SignerProvider
  let ownerAddr: string
  let dexRoot: DexAccountInstance
  let newCode: string

  beforeAll(async () => {
    fixture = await Fixture.create()
    owner = fixture.deployer
    ownerAddr = (await owner.getSelectedAccount()).address
    dexRoot = fixture.powfi.clmm.getDexAccountRoot()
    newCode = DexAccount.contract.bytecode
    await fixture.powfi.clmm.createDexAccount(ownerAddr)
  })

  it('should upgrade root template with NFT', async () => {
    await dexRoot.transact.upgrade({
      signer: owner,
      args: { newCode, tokenId: dexRoot.contractId, path: '' },
      tokens: [{ id: dexRoot.contractId, amount: 1n }],
    })
  })

  it('should fail to upgrade root template without NFT', async () => {
    await expect(dexRoot.transact.upgrade({
      signer: owner,
      args: { newCode, tokenId: dexRoot.contractId, path: '' }
    })).rejects.toThrow()
  })

  it('should upgrade root template using SDK migrateDexAccount', async () => {
    await fixture.powfi.clmm.migrateDexAccount(newCode)
  })

  it('should upgrade user account using root template NFT', async () => {
    const accountId = await fixture.powfi.clmm.getDexAccountId(ownerAddr)
    const account = DexAccount.at(addressFromContractId(accountId))
    const path = binToHex(addressToBytes(ownerAddr))

    await account.transact.upgrade({
      signer: owner,
      args: { newCode, tokenId: dexRoot.contractId, path },
      tokens: [{ id: dexRoot.contractId, amount: 1n }]
    })
  })

  it('should upgrade user account using SDK upgradeUserDexAccount', async () => {
    const tx = await fixture.powfi.clmm.upgradeUserDexAccount(ownerAddr, newCode)
    expect(tx.txId).toBeDefined()
  })

  it('should fail to upgrade root template with fake token', async () => {
    const { tokenId: fakeTokenId } = await mintToken(ownerAddr, 1n)
    await expect(dexRoot.transact.upgrade({
      signer: owner,
      args: { newCode, tokenId: fakeTokenId, path: '' },
      tokens: [{ id: fakeTokenId, amount: 1n }]
    })).rejects.toThrow()
  })

  it('should fail to upgrade user account with invalid path', async () => {
    const accountId = await fixture.powfi.clmm.getDexAccountId(ownerAddr)
    const account = DexAccount.at(addressFromContractId(accountId))
    const invalidPath = binToHex(addressToBytes(fixture.factory.address)) // Use factory address as invalid path

    await expect(account.transact.upgrade({
      signer: owner,
      args: { newCode, tokenId: dexRoot.contractId, path: invalidPath },
      tokens: [{ id: dexRoot.contractId, amount: 1n }]
    })).rejects.toThrow()
  })

  it('should upgrade both root and user account after NFT transfer', async () => {
    const [other] = await getSigners(1, 100n * ONE_ALPH)
    const otherAddr = (await other.getSelectedAccount()).address

    // 1. Create user account for owner
    const accountId = await fixture.powfi.clmm.getDexAccountId(ownerAddr)
    const account = DexAccount.at(addressFromContractId(accountId))
    const path = binToHex(addressToBytes(ownerAddr))

    // 2. Transfer root NFT and user account NFT to other
    await owner.signAndSubmitTransferTx({
      signerAddress: ownerAddr,
      destinations: [
        {
          address: otherAddr,
          tokens: [
            { id: dexRoot.contractId, amount: 1n },
          ],
          attoAlphAmount: DUST_AMOUNT
        }
      ]
    })

    // 3. Upgrade root using other
    const txRoot = await dexRoot.transact.upgrade({
      signer: other,
      args: { newCode, tokenId: dexRoot.contractId, path: '' },
      tokens: [{ id: dexRoot.contractId, amount: 1n }]
    })
    expect(txRoot.txId).toBeDefined()

    // 4. Upgrade user account using other
    const txUser = await account.transact.upgrade({
      signer: other,
      args: { newCode, tokenId: dexRoot.contractId, path },
      tokens: [{ id: dexRoot.contractId, amount: 1n }]
    })
    expect(txUser.txId).toBeDefined()
  })
})
