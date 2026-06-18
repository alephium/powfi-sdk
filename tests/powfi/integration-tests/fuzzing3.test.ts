import { ONE_ALPH, web3 } from '@alephium/web3'
import { getSigner } from '@alephium/web3-test'
import { FuzzChild, FuzzChildCreate, FuzzParent } from 'clmm'

async function run() {
  web3.setCurrentNodeProvider('http://127.0.0.1:22973')

  const signer = await getSigner()
  const { contractInstance: fuzzChild } = await FuzzChild.deployTemplate(signer)
  const { contractInstance: fuzzi } = await FuzzParent.deploy(signer, {
    initialFields: {
      id: fuzzChild.contractId
    },
    issueTokenAmount: ONE_ALPH,
    issueTokenTo: signer.address
  })
  const fuzz = fuzzi.contractId

  await FuzzChildCreate.execute({
    signer,
    initialFields: { fuzz },
    tokens: [{ id: fuzz, amount: ONE_ALPH }]
  })

  await fuzzi.transact.collect({ signer, args: { force: true, amount: 10n } })
  expect((await fuzzi.view.get()).returns).toEqual([0n, 1n])
  await fuzzi.transact.collect({ signer, args: { force: true, amount: 10n } })
  expect((await fuzzi.view.get()).returns).toEqual([0n, 1n])
  await fuzzi.transact.collect({ signer, args: { force: false, amount: 10n } })
  expect((await fuzzi.view.get()).returns).toEqual([0n, 1n])
  const tokens = (await signer.nodeProvider.addresses.getAddressesAddressBalance(signer.address)).tokenBalances
  expect(tokens).toBeUndefined()
  await fuzzi.transact.collect({ signer, args: { force: true, amount: 10n } })
  await fuzzi.transact.collect({ signer, args: { force: false, amount: 10n } })
}

describe('NFT lost', () => {
  test('Test case', async () => {
    await run()
  }, 2_000_000_000)
})
