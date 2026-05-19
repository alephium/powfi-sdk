import { ONE_ALPH, subContractId, Token, web3 } from "@alephium/web3"
import { getSigner } from "@alephium/web3-test"
import { loadClmmDeployments } from "../../../src"
import { FuzzCreateFactory, FuzzFactory, FuzzPosition, FuzzStep } from "clmm"
import { FUZZ_CONFIGS, FUZZ_FACTORIES, FUZZ_POSITIONS, FUZZ_POSITIONS_STEP, FUZZ_SUPPLY } from "clmm/artifacts/ts/constants"

async function run() {
    web3.setCurrentNodeProvider('http://127.0.0.1:22973')

    const maxAlph = 1_000n * ONE_ALPH
    const signer = await getSigner(maxAlph)
    const clmmDeployments = loadClmmDeployments('devnet')
    const dustAmount = 10n * ONE_ALPH
    const attoAlphAmount = 10n * ONE_ALPH

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
        issueTokenAmount: FUZZ_SUPPLY * FUZZ_FACTORIES,
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
    const tokens: Token[] = [{ id: fuzz, amount: FUZZ_SUPPLY }]
    for (let index = 0n; index < FUZZ_FACTORIES; ++index) {
        const id = subContractId(fuzz, index.toString(16).padStart(2, '0'), fuzzi.groupIndex)
        tokens.push({ id, amount: FUZZ_POSITIONS * FUZZ_SUPPLY * FUZZ_FACTORIES * FUZZ_CONFIGS })
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

    for (let i = 0n; i < FUZZ_POSITIONS / FUZZ_POSITIONS_STEP; ++i) {
        for (let index = 0n; index < FUZZ_FACTORIES; index++) {

            await fuzzi.transact.createPositions({
                signer,
                dustAmount,
                attoAlphAmount,
                args: { index }
            })
        }
    }
    for (let iter = 0n; iter < 30_000n; ++iter) {
        if (iter % 100n == 0n) {
            console.log(iter)
        }
        for (let index = 1n; index < FUZZ_FACTORIES; index++) {
            await FuzzStep.execute({
                signer,
                initialFields: {
                    fuzz, iter, index
                },
                dustAmount,
                attoAlphAmount,
                tokens
            })
        }
    }

}

describe('Powfi Fuzzing 2 Gas Tests', () => {
    test.skip('Long running test', async () => {
        await run()
    }, 2_000_000_000)
})