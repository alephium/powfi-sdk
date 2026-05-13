import { web3, stringToHex, ONE_ALPH, subContractId, addressFromContractId } from '@alephium/web3'
import { getSigners } from '@alephium/web3-test'
import { FuzzingUser, FuzzingUserVault, FuzzingTestFactory } from 'clmm'
import { describe, test } from 'vitest'
import { Powfi } from '../../../src/powfi'

async function run() {
    web3.setCurrentNodeProvider('http://127.0.0.1:22973')
    const [signer] = await getSigners(1, 20000n * ONE_ALPH)

    const powfi = new Powfi({ networkId: 'devnet', signer })
    powfi.setCurrentProviders()

    // 1. Deploy the Templates
    const {
        contractInstance: { contractId: userTemplateId }
    } = await FuzzingUser.deployTemplate(signer)

    const { contractInstance: vaultTemplate } = await FuzzingUserVault.deploy(signer, {
        initialFields: {
            user: signer.address
        }
    })

    // 2. Deploy the Test Factory
    const {
        contractInstance: factory
    } = await FuzzingTestFactory.deploy(signer, {
        initialFields: {
            userTemplateId: userTemplateId,
            vaultTemplateId: vaultTemplate.contractId,
            fakeClmmTemplateId: powfi.clmm.getConfig().factoryId,
            fakeCpmmTemplateId: powfi.cpmm.getConfig().factoryId,
            xAlphTokenId: powfi.staking.getConfig().xAlphTokenId,
            nextUserIndex: 0n
        }
    })

    // 3. Try creating as many users as possible
    const usersToCreate = 50n // Lowered default to avoid out-of-gas, feel free to adjust

    console.log(`Attempting to create ${usersToCreate} users...`)

    try {
        const txResult = await factory.transact.createManyUsers({
            signer: signer,
            args: { count: usersToCreate },
            dustAmount: ONE_ALPH * 10n,
            attoAlphAmount: usersToCreate * ONE_ALPH
        })

        console.log('Successfully created users!')
        console.log('Tx ID:', txResult.txId)

        const dustAmountClmm = ONE_ALPH * 10n
        const attoAlphAmountClmm = usersToCreate * ONE_ALPH

        console.log(`Attempting to create CLMM factories for the users...`)
        const txResultClmm = await factory.transact.createManyClmmFactories({
            signer: signer,
            dustAmount: dustAmountClmm,
            attoAlphAmount: attoAlphAmountClmm
        })
        console.log('Successfully created CLMM factories! Tx ID:', txResultClmm.txId)

        const dustAmountCpmm = ONE_ALPH * 10n
        const attoAlphAmountCpmm = usersToCreate * ONE_ALPH

        console.log(`Attempting to create CPMM factories for the users...`)
        const txResultCpmm = await factory.transact.createManyCpmmFactories({
            signer: signer,
            dustAmount: dustAmountCpmm,
            attoAlphAmount: attoAlphAmountCpmm
        })
        console.log('Successfully created CPMM factories! Tx ID:', txResultCpmm.txId)

        const amountPerUser = (1n << 128n) / usersToCreate
        const alphAmountToTransfer = ONE_ALPH * 100n
        const dustAmountDist = ONE_ALPH * 1n
        const attoAlphAmountDist = alphAmountToTransfer + ONE_ALPH * 2n

        console.log(`Distributing tokens...`)
        for (let i = 0n; i < usersToCreate; i++) {
            const userPath = i.toString(16).padStart(2, '0')
            const userContractId = subContractId(factory.contractId, userPath, factory.groupIndex)
            const userContractAddress = addressFromContractId(userContractId)
            const userContract = FuzzingUser.at(userContractAddress)

            const txResultDist = await userContract.transact.distributeTokensToAllUsers({
                signer: signer,
                args: { userCount: usersToCreate, userIndex: i, amountPerUser: amountPerUser, alphAmount: alphAmountToTransfer },
                dustAmount: dustAmountDist,
                attoAlphAmount: attoAlphAmountDist
            })
            console.log(`User ${i} distributed tokens. Tx ID: ${txResultDist.txId}`)
        }

    } catch (e) {
        console.error('Failed to execute testing steps. Gas limit hit or other error:', e)
    }
}

describe('Powfi Fuzzing Gas Tests', () => {
    test('Create max users in single tx', async () => {
        await run()
    }, 5_000_000)
})
