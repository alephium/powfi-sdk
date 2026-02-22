import type { ExecuteScriptResult, HexString } from '@alephium/web3';
import {
  MINIMAL_CONTRACT_DEPOSIT,
  addressFromContractId,
  addressToBytes,
  binToHex,
  codec,
  groupOfAddress,
  isGrouplessAddressWithoutGroupIndex,
  subContractId,
} from '@alephium/web3';
import type {
  AlphUnstakeVaultInstance,
  AlphUnstakeVaultTypes,
  GovernanceDemoInstance,
  RewardSharingVaultInstance,
  XAlphStakeVaultInstance,
  XAlphStakeVaultTypes,
  XAlphTokenInstance,
  XAlphTokenTypes,
} from 'staking/artifacts/ts';
import {
  AlphStakeAndLock,
  AlphUnstakeVault,
  GovernanceDemo,
  RewardSharingVault,
  XAlphStakeVault,
  XAlphToken,
  XAlphUnlockAndStartUnstake,
} from 'staking/artifacts/ts';
import { loadDeployments } from 'staking/artifacts/ts/deployments';
import ModuleBase from '../moduleBase';
import type { PowFi } from '../powfi';
import type { StakeVaultUserInfo, StakingConfig } from './types';
import { decodeContractIdList, decodeU256List } from './utils';
import type { StakingSettings } from './settings';
import { getStakingSettings } from './settings';

export class StakingModule extends ModuleBase {
  private config: StakingConfig;
  private xAlphTokenContract: XAlphTokenInstance;
  private stakeVaultContract: XAlphStakeVaultInstance;

  constructor(scope: PowFi) {
    super({ scope, moduleName: 'StakingModule' });

    this.config = this.loadStakingConfig();
    this.xAlphTokenContract = XAlphToken.at(addressFromContractId(this.config.xAlphTokenId));
    this.stakeVaultContract = XAlphStakeVault.at(
      addressFromContractId(this.config.xAlphStakeVaultId),
    );
  }

  setConfig(config: StakingConfig): void {
    this.config = config;
    this.xAlphTokenContract = XAlphToken.at(addressFromContractId(config.xAlphTokenId));
    this.stakeVaultContract = XAlphStakeVault.at(addressFromContractId(config.xAlphStakeVaultId));
  }

  getConfig(): StakingConfig {
    return this.config;
  }

  getXAlphToken(): XAlphTokenInstance {
    return this.xAlphTokenContract;
  }

  getStakeVault(): XAlphStakeVaultInstance {
    return this.stakeVaultContract;
  }

  getRewardSharingVault(contractId: string): RewardSharingVaultInstance {
    return RewardSharingVault.at(addressFromContractId(contractId));
  }

  getGovernanceContract(contractId: string): GovernanceDemoInstance {
    return GovernanceDemo.at(addressFromContractId(contractId));
  }

  async getXAlphTokenState(): Promise<XAlphTokenTypes.State> {
    return this.xAlphTokenContract.fetchState();
  }

  async getStakeVaultState(): Promise<XAlphStakeVaultTypes.State> {
    return this.stakeVaultContract.fetchState();
  }

  async stakeAlph(amount: bigint): Promise<XAlphTokenTypes.SignExecuteMethodResult<'stake'>> {
    this.ensurePositiveAmount(amount, 'Stake amount');
    return this.xAlphTokenContract.transact.stake({
      signer: this.scope.signer,
      args: { amount },
      attoAlphAmount: amount + MINIMAL_CONTRACT_DEPOSIT,
    });
  }

  async startUnstake(
    amount: bigint,
  ): Promise<XAlphTokenTypes.SignExecuteMethodResult<'startUnstake'>> {
    this.ensurePositiveAmount(amount, 'Unstake amount');
    return this.xAlphTokenContract.transact.startUnstake({
      signer: this.scope.signer,
      args: { amount },
      tokens: [{ id: this.config.xAlphTokenId, amount }],
    });
  }

  async claimUnstaked(
    vaultIndex: bigint,
    amount: bigint,
  ): Promise<XAlphTokenTypes.SignExecuteMethodResult<'claimUnstaked'>> {
    this.ensurePositiveAmount(amount, 'Claim amount');
    return this.xAlphTokenContract.transact.claimUnstaked({
      signer: this.scope.signer,
      args: {
        vaultIndex,
        amount,
      },
    });
  }

  async cancelUnstake(
    vaultIndex: bigint,
  ): Promise<XAlphTokenTypes.SignExecuteMethodResult<'cancelUnstake'>> {
    return this.xAlphTokenContract.transact.cancelUnstake({
      signer: this.scope.signer,
      args: { vaultIndex },
    });
  }

  async stakeXAlph(amount: bigint): Promise<XAlphStakeVaultTypes.SignExecuteMethodResult<'stake'>> {
    this.ensurePositiveAmount(amount, 'Stake amount');
    return this.stakeVaultContract.transact.stake({
      signer: this.scope.signer,
      args: { amount },
      tokens: [{ id: this.config.xAlphTokenId, amount }],
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT,
    });
  }

  async unstakeXAlph(
    amount: bigint,
  ): Promise<XAlphStakeVaultTypes.SignExecuteMethodResult<'unstake'>> {
    this.ensurePositiveAmount(amount, 'Unstake amount');
    return this.stakeVaultContract.transact.unstake({
      signer: this.scope.signer,
      args: { amount },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT,
    });
  }

  async stakeAndLockAlph(amount: bigint): Promise<ExecuteScriptResult> {
    return AlphStakeAndLock.execute({
      signer: this.scope.signer,
      initialFields: {
        xAlphToken: this.xAlphTokenContract.contractId,
        xAlphStakeVault: this.stakeVaultContract.contractId,
        amount,
      },
      attoAlphAmount: amount + MINIMAL_CONTRACT_DEPOSIT,
    });
  }

  async unlockAndStartUnstake(amount: bigint): Promise<ExecuteScriptResult> {
    return XAlphUnlockAndStartUnstake.execute({
      signer: this.scope.signer,
      initialFields: {
        xAlphToken: this.xAlphTokenContract.contractId,
        xAlphStakeVault: this.stakeVaultContract.contractId,
        amount,
      },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT,
    });
  }

  getAlphUnstakeVault(userAddress: string, vaultIndex: bigint): AlphUnstakeVaultInstance {
    const userHex = binToHex(addressToBytes(userAddress));
    const indexHex = binToHex(codec.u256Codec.encode(vaultIndex));
    const contractId = subContractId(
      this.config.xAlphTokenId,
      `${userHex}${indexHex}`,
      groupOfAddress(this.config.xAlphTokenAddress),
    );
    return AlphUnstakeVault.at(addressFromContractId(contractId));
  }

  async getAlphUnstakeVaultState(
    userAddress: string,
    vaultIndex: bigint,
  ): Promise<AlphUnstakeVaultTypes.State> {
    const stakerAddress = this.getStakerAddress(userAddress);
    return this.getAlphUnstakeVault(stakerAddress, vaultIndex).fetchState();
  }

  async connectToDapp(
    contractId: string,
    merkleProof: HexString,
  ): Promise<XAlphStakeVaultTypes.SignExecuteMethodResult<'connectToDapp'>> {
    return this.stakeVaultContract.transact.connectToDapp({
      signer: this.scope.signer,
      args: { contractId, merkleProof },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT,
    });
  }

  async disconnectFromDapp(
    contractId: string,
  ): Promise<XAlphStakeVaultTypes.SignExecuteMethodResult<'disconnectFromDapp'>> {
    return this.stakeVaultContract.transact.disconnectFromDapp({
      signer: this.scope.signer,
      args: { contractId },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT,
    });
  }

  async getUserStakeVaultInfo(address: string): Promise<StakeVaultUserInfo> {
    const stakerAddress = this.getStakerAddress(address);
    const result = await this.stakeVaultContract.view.getUserStakingInfo({
      args: { user: stakerAddress },
    });
    return {
      amount: result.returns.amount,
      connectedDapps: decodeContractIdList(result.returns.connectedDapps),
    };
  }

  async isUserStaking(address: string): Promise<boolean> {
    const stakerAddress = this.getStakerAddress(address);
    const result = await this.stakeVaultContract.view.isStaking({ args: { user: stakerAddress } });
    return result.returns;
  }

  async getUserWeight(address: string): Promise<bigint> {
    const stakerAddress = this.getStakerAddress(address);
    const result = await this.stakeVaultContract.view.getWeight({ args: { user: stakerAddress } });
    return result.returns;
  }

  async getActiveUnstakeVaultIndexes(address: string): Promise<bigint[]> {
    const stakerAddress = this.getStakerAddress(address);
    const result = await this.xAlphTokenContract.view.getActiveUnstakeVaultIndexes({
      args: { caller: stakerAddress },
    });
    return decodeU256List(result.returns);
  }

  async getClaimableAmount(address: string, vaultIndex: bigint): Promise<bigint> {
    const stakerAddress = this.getStakerAddress(address);
    const result = await this.xAlphTokenContract.view.getClaimableAmount({
      args: { user: stakerAddress, vaultIndex },
    });
    return result.returns;
  }

  getSettings(): StakingSettings {
    return getStakingSettings(this.scope.network.id);
  }

  private loadStakingConfig(): StakingConfig {
    const networkId = this.scope.network.id;
    try {
      const deployments = loadDeployments(networkId);
      const alphUnstakeVault = deployments.contracts.AlphUnstakeVault.contractInstance;
      const xAlphToken = deployments.contracts.XAlphToken.contractInstance;
      const stakeVault = deployments.contracts.XAlphStakeVault.contractInstance;
      const rewardVault = deployments.contracts.RewardSharingVault.contractInstance;
      const governance = deployments.contracts.GovernanceDemo.contractInstance;
      return {
        groupIndex: stakeVault.groupIndex,
        alphUnstakeVaultTemplateId: alphUnstakeVault.contractId,
        xAlphTokenId: xAlphToken.contractId,
        xAlphTokenAddress: xAlphToken.address,
        xAlphStakeVaultId: stakeVault.contractId,
        xAlphStakeVaultAddress: stakeVault.address,
        rewardSharingTemplateId: rewardVault.contractId,
        governanceDemoTemplateId: governance.contractId,
      };
    } catch (error) {
      this.logAndThrowError(`Failed to load staking deployments on ${networkId}`, error);
    }
  }

  private ensurePositiveAmount(amount: bigint, label: string): void {
    if (amount <= 0n) {
      throw new Error(`${label} must be greater than zero`);
    }
  }

  private getStakerAddress(address: string): string {
    if (isGrouplessAddressWithoutGroupIndex(address)) {
      return `${address}:${this.stakeVaultContract.groupIndex}`;
    }
    return address;
  }
}
