import type { SignerProvider } from '@alephium/web3'
import { ONE_ALPH, web3, DUST_AMOUNT, ALPH_TOKEN_ID, groupOfAddress } from '@alephium/web3'
import { getSigners, mintToken } from '@alephium/web3-test'
import type { TokenPairFactoryInstance, DexAccountInstance } from 'cpmm'
import { TokenPair, TokenPairFactory, DexAccount, CreatePairAndAddLiquidity } from 'cpmm'
import { Powfi } from '../../../src/powfi'
import { sortTokens } from '../../../src/common/utils'

export interface Balances {
  alph: bigint
  tokens: Record<string, bigint>
}

export async function getBalances(address: string, tokenIds: string[]): Promise<Balances> {
  const balance = await web3.getCurrentNodeProvider().addresses.getAddressesAddressBalance(address)
  const tokens: Record<string, bigint> = {}
  for (const id of tokenIds) {
    const token = balance.tokenBalances?.find((t) => t.id === id)
    tokens[id] = token ? BigInt(token.amount) : 0n
  }
  return { alph: BigInt(balance.balance), tokens }
}

export class Fixture {
  constructor(
    readonly factory: TokenPairFactoryInstance,
    readonly dexAccountTemplate: DexAccountInstance,
    readonly tokenId0: string,
    readonly tokenId1: string,
    readonly powfi: Powfi,
    readonly deployer: SignerProvider
  ) {}

  static async create(isAlph: boolean = false): Promise<Fixture> {
    const [deployer] = await getSigners(1, 2000n * ONE_ALPH)

    const powfi = new Powfi({ networkId: 'devnet', signer: deployer })
    return this.load(powfi, isAlph)
  }

  static async load(powfi: Powfi, isAlph: boolean = false): Promise<Fixture> {
    const deployer = powfi.signer
    const address = (await deployer.getSelectedAccount()).address

    powfi.setCurrentProviders()

    const pairTemplateDeploy = await TokenPair.deployTemplate(deployer)
    const pairTemplate = pairTemplateDeploy.contractInstance

    const dexAccountTemplateDeploy = await DexAccount.deploy(deployer, {
      initialFields: {
        counter: 0n,
        owner: address,
        parents: ['', ''],
        referrer: address
      }
    })
    const dexAccountTemplate = dexAccountTemplateDeploy.contractInstance

    const factoryDeploy = await TokenPairFactory.deploy(deployer, {
      initialFields: {
        dexAccount0: dexAccountTemplate.contractId,
        pairTemplateId: pairTemplate.contractId,
        pairSize: 0n,
        owner: address,
        feeCollector: address,
        refRate: 0n
      }
    })
    const factory = factoryDeploy.contractInstance

    const initialAmount = 1_000_000n * ONE_ALPH
    const { tokenId: tokenA } = await mintToken(address, initialAmount)
    const { tokenId: tokenB } = await mintToken(address, initialAmount)
    const tokens = sortTokens(tokenA, tokenB)
    if (isAlph) {
      tokens[0] = ALPH_TOKEN_ID
    }

    powfi.cpmm.setConfig({
      ...powfi.cpmm.getConfig(),
      factoryId: factory.contractId,
      groupIndex: groupOfAddress(address)
    })

    return new Fixture(factory, dexAccountTemplate, tokens[0], tokens[1], powfi, deployer)
  }

  async createPool(amount0: bigint, amount1: bigint) {
    const [t0, t1] = [this.tokenId0, this.tokenId1]
    const [a0, a1] = [amount0, amount1]
    const deployer = await this.deployer.getSelectedAccount()

    return await CreatePairAndAddLiquidity.execute({
      signer: this.deployer,
      initialFields: {
        payer: deployer.address,
        factory: this.factory.contractId,
        alphAmount: ONE_ALPH,
        token0Id: t0,
        token1Id: t1,
        amount0: a0,
        amount1: a1,
        dexAccount: this.dexAccountTemplate.contractId
      },
      attoAlphAmount: ONE_ALPH + (t0 === ALPH_TOKEN_ID ? a0 : 0n) + (t1 === ALPH_TOKEN_ID ? a1 : 0n) + DUST_AMOUNT * 3n,
      tokens: [
        ...(t0 === ALPH_TOKEN_ID ? [] : [{ id: t0, amount: a0 }]),
        ...(t1 === ALPH_TOKEN_ID ? [] : [{ id: t1, amount: a1 }])
      ]
    })
  }
}
