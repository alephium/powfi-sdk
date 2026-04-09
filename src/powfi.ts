import type { SignerProvider, Account } from '@alephium/web3'
import { NodeProvider, ExplorerProvider, web3 } from '@alephium/web3'
import { CpmmModule } from './cpmm/cpmm'
import type { Network, PowfiLoadParams } from './common/types'
import { defaultNetworks } from './common/types'
import { ClmmModule } from './clmm/clmm'
import { TokenModule } from './token/token'
import { StakingModule } from './staking/staking'

/**
 * Main entry point for the Powfi SDK.
 *
 * Provides access to all protocol modules: CPMM (constant-product AMM),
 * CLMM (concentrated liquidity AMM), token metadata, and xALPH staking.
 *
 * @example
 * ```ts
 * const powfi = Powfi.load({ networkId: 'mainnet', signer })
 * const pool = await powfi.cpmm.getPoolState(tokenA, tokenB)
 * ```
 */
export class Powfi {
  /** Constant-product market maker module (swap, add/remove liquidity). */
  public cpmm: CpmmModule
  /** Concentrated liquidity market maker module. */
  public clmm: ClmmModule
  /** Token metadata lookups from the Alephium token list. */
  public token: TokenModule
  /** xALPH staking module (stake, unstake, governance). */
  public staking: StakingModule

  private _nodeProvider: NodeProvider
  private _explorerProvider: ExplorerProvider
  private _tokenListUrl: string
  private _signer?: SignerProvider
  private _account?: Account
  private _network: Network

  constructor(params: PowfiLoadParams) {
    const network = defaultNetworks.find((n) => n.id === params.networkId)
    if (!network) {
      throw new Error(`Network ${params.networkId} not found`)
    }

    const overrides = params.networkOverrides ?? {}
    const networkConfig: Network = { ...network, ...overrides }

    this._network = networkConfig
    this._nodeProvider = new NodeProvider(this._network.nodeUrl, this._network.nodeApiKey)
    this._explorerProvider = new ExplorerProvider(this._network.explorerApiUrl)
    this._tokenListUrl = this._network.tokenListUrl
    this._signer = params.signer

    // Initialize modules
    this.cpmm = new CpmmModule(this)
    this.clmm = new ClmmModule(this)
    this.token = new TokenModule(this)
    this.staking = new StakingModule(this)
  }

  /** Create a new Powfi SDK instance with the given network and signer configuration. */
  static load(config: PowfiLoadParams): Powfi {
    return new Powfi(config)
  }

  public set signer(signer: SignerProvider) {
    this._signer = signer
  }

  public set account(account: Account) {
    this._account = account
  }

  get signer(): SignerProvider {
    if (!this._signer) {
      throw new Error('Signer not set')
    }
    return this._signer
  }

  get account(): Account {
    if (!this._account) {
      throw new Error('Account not set')
    }
    return this._account
  }

  /** Remove the current signer. Transaction methods will throw until a new signer is set. */
  public clearSigner() {
    this._signer = undefined
  }

  public clearAccount() {
    this._account = undefined
  }

  get nodeProvider(): NodeProvider {
    return this._nodeProvider
  }

  get explorerProvider(): ExplorerProvider {
    return this._explorerProvider
  }

  get network(): Network {
    return this._network
  }

  get tokenListUrl(): string {
    return this._tokenListUrl
  }

  /** Set this instance's node and explorer providers as the global `web3` defaults. */
  public setCurrentProviders(): void {
    if (!this._nodeProvider) {
      throw new Error('Node provider not set')
    }
    if (!this._explorerProvider) {
      throw new Error('Explorer provider not set')
    }
    web3.setCurrentNodeProvider(this._nodeProvider)
    web3.setCurrentExplorerProvider(this._explorerProvider)
  }
}
