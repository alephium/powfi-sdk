import type { Token } from '@alephium/web3'
import { MINIMAL_CONTRACT_DEPOSIT, ONE_ALPH, sleep, subContractId, web3 } from '@alephium/web3'
import { getSigner } from '@alephium/web3-test'
import { loadClmmDeployments, U256_MAX } from '../../../src'
import {
  FuzzCreateFactory,
  FuzzFactory,
  FuzzPosition,
  FuzzStep,
  FuzzCollect,
  FuzzCleanup,
  FuzzCloseRewards,
  DexAccount,
  FuzzPool,
  FuzzPoolInit,
  FuzzPoolClose
} from 'clmm'
import {
  FUZZ_CONFIGS,
  FUZZ_FACTORIES,
  FUZZ_POSITIONS,
  FUZZ_POSITIONS_STEP,
  FUZZ_SUPPLY
} from 'clmm/artifacts/ts/constants'
import { PrivateKeyWallet } from '@alephium/web3-wallet'

async function run() {
  web3.setCurrentNodeProvider('http://127.0.0.1:22973')

  const maxAlph = 200_000n * ONE_ALPH
  const signer = await getSigner(maxAlph)
  const clmmDeployments = loadClmmDeployments('devnet')
  const dustAmount = 2000n * ONE_ALPH
  const attoAlphAmount = 2000n * ONE_ALPH

  const { contractInstance: fuzzPositionTemplateInstance } = await FuzzPosition.deployTemplate(signer)
  const { contractInstance: fuzzPoolTemplateInstance } = await FuzzPool.deployTemplate(signer)
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
      fuzzPoolTemplate: fuzzPoolTemplateInstance.contractId,
      nextIndex: 0n,
      nextPosition: 0n
    },
    issueTokenAmount: U256_MAX,
    issueTokenTo: signer.address
  })
  const dexRoot = DexAccount.at(clmmDeployments.contracts.DexAccount.contractInstance.address)
  const signer2 = PrivateKeyWallet.Random(signer.group)
  await dexRoot.transact.createAccount({
    signer,
    args: {
      ref: signer2.address
    },
    dustAmount: MINIMAL_CONTRACT_DEPOSIT,
    attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
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

  console.log('init...')
  for (let index = 0n; index < FUZZ_FACTORIES; index++) {
    for (let index2 = 0n; index2 < FUZZ_FACTORIES; index2++) {
      if (index === index2) continue
      await FuzzPoolInit.execute({
        signer,
        initialFields: {
          fuzz,
          index,
          index2
        },
        attoAlphAmount,
        dustAmount,
        tokens
      })
    }
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
  let shouldStop = false
  process.on('SIGINT', () => {
    shouldStop = true
  })

  try {
    for (let iter = 0n; iter < 30_000n; ++iter) {
      if (shouldStop) break
      console.log('step', iter)
      for (let index = 0n; index < FUZZ_FACTORIES; index++) {
        if (shouldStop) break
        await FuzzStep.execute({
          signer,
          initialFields: {
            fuzz,
            iter,
            index
          },
          attoAlphAmount,
          tokens,
          dustAmount
        })
      }
    }
  } catch (err) {
    console.error('Error during fuzz steps:', err)
  }

  console.log('Closing rewards...')
  await FuzzCloseRewards.execute({
    signer,
    initialFields: {
      fuzz
    },
    attoAlphAmount,
    dustAmount,
    tokens
  })
  await sleep(1000)

  for (let index = 0n; index < FUZZ_FACTORIES; index++) {
    console.log('collecting...', index)
    for (let iter = 0n; iter < FUZZ_POSITIONS; iter++) {
      await FuzzCollect.execute({
        signer,
        initialFields: {
          fuzz,
          index,
          iter
        },
        attoAlphAmount,
        dustAmount
      })
    }
  }

  console.log('closing pools...')
  for (let index = 0n; index < FUZZ_FACTORIES; index++) {
    await FuzzPoolClose.execute({
      signer,
      initialFields: {
        fuzz,
        index
      },
      attoAlphAmount,
      dustAmount,
      tokens
    })
  }

  console.log('cleanup...')
  await FuzzCleanup.execute({
    signer,
    initialFields: {
      fuzz,
      iter: 0n
    },
    attoAlphAmount,
    dustAmount
  })
  await FuzzCleanup.execute({
    signer,
    initialFields: {
      fuzz,
      iter: 1n
    },
    attoAlphAmount,
    dustAmount
  })
  for (let index = 0n; index < FUZZ_FACTORIES; index++) {
    for (let index2 = 0n; index2 < FUZZ_FACTORIES; index2++) {
      if (index === index2) continue
      for (let configIndex = 0n; configIndex < FUZZ_CONFIGS; configIndex++) {
        try {
          const {
            returns: [poolAddress, token0, token1]
          } = await fuzzi.view.getPoolAddress({
            args: { index, index2, configIndex }
          })
          const balances = await signer.nodeProvider.addresses.getAddressesAddressBalance(poolAddress)
          const getAmount = (tokenId: string) => {
            const tb = balances.tokenBalances?.find((t) => t.id === tokenId)
            return tb ? tb.amount : '0'
          }
          console.log(
            `pool(${index},${index2},${configIndex}): [${getAmount(token0)}, ${getAmount(token1)}, ${getAmount(fuzz)}]`
          )
        } catch (e) {
          console.log(`pool(${index},${index2},${configIndex}): N/A`)
        }
      }
    }
  }
}
describe('Powfi Fuzzing 2 Gas Tests', () => {
  test.skip('Long running test', async () => {
    await run()
  }, 2_000_000_000)
})
