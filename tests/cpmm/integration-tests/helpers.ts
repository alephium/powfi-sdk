import type { SignerProvider } from '@alephium/web3'
import { ONE_ALPH, web3, DUST_AMOUNT, ALPH_TOKEN_ID, groupOfAddress } from '@alephium/web3'
import type { TokenInfo } from '@alephium/token-list'
import { getSigners, mintToken } from '@alephium/web3-test'
import type { TokenPairFactoryInstance, DummyDexRootInstance, RouterInstance } from 'cpmm'
import { TokenPair, TokenPairFactory, DummyDexRoot, Router, CreatePairAndAddLiquidity } from 'cpmm'
import { Powfi } from '../../../src/powfi'
import { sortTokens } from '../../../src/common/utils'

function testTokenInfo(id: string, symbol: string): TokenInfo {
  return { id, name: symbol, symbol, decimals: 18, description: '', logoURI: '' }
}

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
    readonly dexAccountTemplate: DummyDexRootInstance,
    readonly router: RouterInstance,
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

    const dexAccountTemplateDeploy = await DummyDexRoot.deploy(deployer, {
      initialFields: {
        owner: address
      }
    })
    const dexAccountTemplate = dexAccountTemplateDeploy.contractInstance

    const factoryDeploy = await TokenPairFactory.deploy(deployer, {
      initialFields: {
        dexRoot: dexAccountTemplate.contractId,
        pairTemplateId: pairTemplate.contractId,
        pairSize: 0n,
        owner: address,
        feeCollector: address,
        refRate: 0n,
        upgrader: address
      }
    })
    const factory = factoryDeploy.contractInstance

    const routerDeploy = await Router.deploy(deployer, { initialFields: {} })
    const router = routerDeploy.contractInstance

    const initialAmount = 1_000_000n * ONE_ALPH
    const { tokenId: tokenA } = await mintToken(address, initialAmount)
    const { tokenId: tokenB } = await mintToken(address, initialAmount)
    const tokens = sortTokens(tokenA, tokenB)
    if (isAlph) {
      tokens[0] = ALPH_TOKEN_ID
    }

    const tokenInfos = [ALPH_TOKEN_ID, tokens[0], tokens[1]]
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .map((id, index) => testTokenInfo(id, id === ALPH_TOKEN_ID ? 'ALPH' : `TT${index}`))
    powfi.token.getTokens = () => Promise.resolve(tokenInfos)

    powfi.cpmm.setConfig({
      ...powfi.cpmm.getConfig(),
      factoryId: factory.contractId,
      routerId: router.contractId,
      groupIndex: groupOfAddress(address)
    })

    return new Fixture(factory, dexAccountTemplate, router, tokens[0], tokens[1], powfi, deployer)
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
        amount1: a1
      },
      attoAlphAmount: ONE_ALPH + (t0 === ALPH_TOKEN_ID ? a0 : 0n) + (t1 === ALPH_TOKEN_ID ? a1 : 0n) + DUST_AMOUNT * 3n,
      tokens: [
        ...(t0 === ALPH_TOKEN_ID ? [] : [{ id: t0, amount: a0 }]),
        ...(t1 === ALPH_TOKEN_ID ? [] : [{ id: t1, amount: a1 }])
      ]
    })
  }
}
