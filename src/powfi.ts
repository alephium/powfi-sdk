import type { SignerProvider, Account } from '@alephium/web3';
import { NodeProvider, ExplorerProvider, web3 } from '@alephium/web3';
import { CpmmModule } from './cpmm/cpmm';
import type { Network, PowFiLoadParams } from './common/types';
import { defaultNetworks } from './common/types';
import { ClmmModule } from './clmm/clmm';
import { TokenModule } from './token/token';
import { StakingModule } from './staking/staking';

export class PowFi {
  public cpmm: CpmmModule;
  public clmm: ClmmModule;
  public token: TokenModule;
  public staking: StakingModule;

  private _nodeProvider: NodeProvider;
  private _explorerProvider: ExplorerProvider;
  private _tokenListUrl: string;
  private _signer?: SignerProvider;
  private _account?: Account;
  private _network: Network;

  constructor(params: PowFiLoadParams) {
    const network = defaultNetworks.find((n) => n.id === params.networkId);
    if (!network) {
      throw new Error(`Network ${params.networkId} not found`);
    }

    const overrides = params.networkOverrides ?? {};
    const networkConfig: Network = { ...network, ...overrides };

    this._network = networkConfig;
    this._nodeProvider = new NodeProvider(this._network.nodeUrl, this._network.nodeApiKey);
    this._explorerProvider = new ExplorerProvider(this._network.explorerApiUrl);
    this._tokenListUrl = this._network.tokenListUrl;
    this._signer = params.signer;

    // Initialize modules
    this.cpmm = new CpmmModule(this);
    this.clmm = new ClmmModule(this);
    this.token = new TokenModule(this);
    this.staking = new StakingModule(this);
  }

  static load(config: PowFiLoadParams): PowFi {
    return new PowFi(config);
  }

  public set signer(signer: SignerProvider) {
    this._signer = signer;
  }

  public set account(account: Account) {
    this._account = account;
  }

  get signer(): SignerProvider {
    if (!this._signer) {
      throw new Error('Signer not set');
    }
    return this._signer;
  }

  get account(): Account {
    if (!this._account) {
      throw new Error('Account not set');
    }
    return this._account;
  }

  public clearSigner() {
    this._signer = undefined;
  }

  public clearAccount() {
    this._account = undefined;
  }

  get nodeProvider(): NodeProvider {
    return this._nodeProvider;
  }

  get explorerProvider(): ExplorerProvider {
    return this._explorerProvider;
  }

  get network(): Network {
    return this._network;
  }

  get tokenListUrl(): string {
    return this._tokenListUrl;
  }

  public setCurrentProviders(): void {
    if (!this._nodeProvider) {
      throw new Error('Node provider not set');
    }
    if (!this._explorerProvider) {
      throw new Error('Explorer provider not set');
    }
    web3.setCurrentNodeProvider(this._nodeProvider);
    web3.setCurrentExplorerProvider(this._explorerProvider);
  }
}
