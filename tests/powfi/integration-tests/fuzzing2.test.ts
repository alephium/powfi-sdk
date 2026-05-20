import { ALPH_TOKEN_ID, ONE_ALPH, sleep, subContractId, Token, web3 } from "@alephium/web3"
import { getSigner } from "@alephium/web3-test"
import { loadClmmDeployments, U256_MAX } from "../../../src"
import { FuzzCreateFactory, FuzzFactory, FuzzPosition, FuzzStep } from "clmm"
import { FUZZ_CONFIGS, FUZZ_FACTORIES, FUZZ_POSITIONS, FUZZ_POSITIONS_STEP, FUZZ_SUPPLY } from "clmm/artifacts/ts/constants"
import { PrivateKeyWallet } from "@alephium/web3-wallet"

async function run() {
    web3.setCurrentNodeProvider('http://127.0.0.1:22973')

    const maxAlph = 200_000n * ONE_ALPH
    const signer = await getSigner(maxAlph)
    const clmmDeployments = loadClmmDeployments('devnet')
    const dustAmount = 200n * ONE_ALPH
    const attoAlphAmount = 200n * ONE_ALPH

    const { contractInstance: fuzzPositionTemplateInstance } = await FuzzPosition.deployTemplate(signer)
    const { contractInstance: fuzzi } = await FuzzFactory.deploy(signer, {
        initialFields: {
            poolFactoryTemplate: clmmDeployments.contracts.PoolFactory.contractInstance.contractId,
            poolTemplate: clmmDeployments.contracts.Pool.contractInstance.contractId,
            positionTemplate: clmmDeployments.contracts.Position.contractInstance.contractId,
            tickTemplate: clmmDeployments.contracts.Tick.contractInstance.contractId,
            wordTemplate: clmmDeployments.contracts.BitmapWord.contractInstance.contractId,
            poolConfigTemplate: clmmDeployments.contracts.PoolConfig.contractInstance.contractId,
            dexAccountRoot: clmmDeployments.contracts.DexAccount.contractInstance.contractId,
            fuzzPositionTemplate: fuzzPositionTemplateInstance.contractId,
            nextIndex: 0n,
            nextPosition: 0n
        },
        issueTokenAmount: U256_MAX,
        issueTokenTo: signer.address
    })
    const fuzz = fuzzi.contractId

    for (let i = 0n; i < FUZZ_FACTORIES; i++) {
        await FuzzCreateFactory.execute({
            signer,
            initialFields: { fuzz },
            dustAmount,
            attoAlphAmount
        })
    }
    const amount = FUZZ_POSITIONS * FUZZ_SUPPLY * FUZZ_FACTORIES * FUZZ_CONFIGS
    const tokens: Token[] = [{ id: fuzz, amount }]
    for (let index = 0n; index < FUZZ_FACTORIES; ++index) {
        const id = subContractId(fuzz, index.toString(16).padStart(2, '0'), fuzzi.groupIndex)
        tokens.push({ id, amount })
    }
    for (let index = 0n; index < FUZZ_FACTORIES; index++) {
        await fuzzi.transact.createPools({
            signer,
            dustAmount,
            attoAlphAmount,
            args: { index },
            tokens
        })
    }

    for (let index = 0n; index < FUZZ_FACTORIES; index++) {
        console.log('positions', index)
        for (let index2 = 0n; index2 < FUZZ_FACTORIES; index2++) {
            if (index === index2) continue
            for (let configIndex = 0n; configIndex < FUZZ_CONFIGS; configIndex++) {
                for (let i = 0n; i < FUZZ_POSITIONS / FUZZ_POSITIONS_STEP; ++i) {
                    await fuzzi.transact.createPositions({
                        signer,
                        dustAmount,
                        attoAlphAmount,
                        args: { index, index2 }
                    })
                }
            }
        }
    }
    for (let iter = 0n; iter < 30_000n; ++iter) {
        console.log('step', iter)
        for (let index = 0n; index < FUZZ_FACTORIES; index++) {
            await FuzzStep.execute({
                signer,
                initialFields: {
                    fuzz, iter, index
                },
                attoAlphAmount,
                tokens,
                dustAmount,
            })
        }
    }

}

// describe('Powfi Fuzzing 2 Gas Tests', () => {
// test('Long running test', async () => {
run()
// }, 2_000_000_000)
// })