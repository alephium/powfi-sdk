import { binToHex } from '@alephium/web3'
import { getSigners } from '@alephium/web3-test'
import { PoolFactory } from 'clmm/artifacts/ts'
import { Fixture } from './helpers'
import type { SignerProvider } from '@alephium/web3'

describe('PoolFactory Upgrade Integration Test', () => {
  let fixture: Fixture
  let owner: SignerProvider
  let ownerAddress: string
  let newFactoryCode: string

  beforeAll(async () => {
    fixture = await Fixture.create()
    owner = fixture.deployer
    ownerAddress = (await owner.getSelectedAccount()).address
    newFactoryCode = PoolFactory.contract.bytecode
  })

  it('should upgrade factory template code', async () => {
    const factory = fixture.factory
    const state = await factory.fetchState()
    const { encodedImmFields, encodedMutFields } = PoolFactory.encodeFields(state.fields)
    const tx = await factory.transact.upgrade({
      signer: owner,
      args: {
        newBytecode: newFactoryCode,
        immFields: binToHex(encodedImmFields),
        mutFields: binToHex(encodedMutFields)
      }
    })
    expect(tx.txId).toBeDefined()
  })

  it('should fail to upgrade template if caller is not owner', async () => {
    const other = (await getSigners(2))[1]
    const factory = fixture.factory
    const state = await factory.fetchState()
    const { encodedImmFields, encodedMutFields } = PoolFactory.encodeFields(state.fields)
    await expect(
      factory.transact.upgrade({
        signer: other,
        args: {
          newBytecode: newFactoryCode,
          immFields: binToHex(encodedImmFields),
          mutFields: binToHex(encodedMutFields)
        }
      })
    ).rejects.toThrow()
  })

  it('should upgrade template using SDK migrateFactory', async () => {
    const tx = await fixture.powfi.clmm.migrateFactory(newFactoryCode)
    expect(tx.txId).toBeDefined()
  })

  it('should fail to change upgrader if caller is not upgrader', async () => {
    const other = (await getSigners(2))[1]
    const factory = fixture.factory
    await expect(
      factory.transact.changeUpgrader({
        signer: other,
        args: { newUpgrader: '111111111111111111111111111111111' }
      })
    ).rejects.toThrow()
  })

  it('should finalize template using SDK finalizeFactory', async () => {
    const tx = await fixture.powfi.clmm.finalizeFactory()
    expect(tx.txId).toBeDefined()

    const factory = fixture.factory
    const state = await factory.fetchState()
    expect(state.fields.upgrader).toBe('111111111111111111111111111111111')
  })

  it('should fail to upgrade after finalization', async () => {
    const factory = fixture.factory
    const state = await factory.fetchState()
    const { encodedImmFields, encodedMutFields } = PoolFactory.encodeFields(state.fields)
    await expect(
      factory.transact.upgrade({
        signer: owner,
        args: {
          newBytecode: newFactoryCode,
          immFields: binToHex(encodedImmFields),
          mutFields: binToHex(encodedMutFields)
        }
      })
    ).rejects.toThrow()

    await expect(fixture.powfi.clmm.migrateFactory(newFactoryCode)).rejects.toThrow()
  })

  it('should transfer ownership successfully and be able to transfer it back', async () => {
    const factory = fixture.factory
    const other = (await getSigners(2))[1]
    const otherAddress = other.address

    // 1. Transferring ownership with non-owner signer should fail
    await expect(
      factory.transact.transferOwnership({
        signer: other,
        args: { newOwner: otherAddress }
      })
    ).rejects.toThrow()

    // 2. Transferring ownership correctly should succeed without token approval
    const tx = await factory.transact.transferOwnership({
      signer: owner,
      args: { newOwner: otherAddress }
    })
    expect(tx.txId).toBeDefined()

    // Verify ownership has transferred
    let state = await factory.fetchState()
    expect(state.fields.owner).toBe(otherAddress)

    // 3. Now the new owner (other) transfers ownership back to the original owner
    const txBack = await factory.transact.transferOwnership({
      signer: other,
      args: { newOwner: ownerAddress }
    })
    expect(txBack.txId).toBeDefined()

    // Verify ownership has transferred back
    state = await factory.fetchState()
    expect(state.fields.owner).toBe(ownerAddress)
  })
})
