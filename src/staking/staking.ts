import type { ExecuteScriptResult, HexString } from '@alephium/web3'
import {
  DUST_AMOUNT,
  MINIMAL_CONTRACT_DEPOSIT,
  addressFromContractId,
  addressToBytes,
  binToHex,
  codec,
  groupOfAddress,
  isGrouplessAddressWithoutGroupIndex,
  subContractId
} from '@alephium/web3'
import type {
  AlphUnstakeVaultInstance,
  AlphUnstakeVaultTypes,
  GovernanceDemoInstance,
  RewardSharingVaultInstance,
  XAlphStakeVaultInstance,
  XAlphStakeVaultTypes,
  XAlphTokenInstance,
  XAlphTokenTypes
} from 'staking/artifacts/ts'
import {
  AlphUnstakeVault,
  GovernanceDemo,
  RewardSharingVault,
  XAlphStakeVault,
  XAlphToken,
  XAlphUnlockAndStartUnstake
} from 'staking/artifacts/ts'
import { loadDeployments } from 'staking/artifacts/ts/deployments'
import ModuleBase from '../moduleBase'
import type { Powfi } from '../powfi'
import type { StakeVaultUserInfo, StakingConfig } from './types'
import { decodeContractIdList, decodeU256List } from './utils'
import type { StakingSettings } from './settings'
import { getStakingSettings } from './settings'

/**
 * Provides xALPH liquid staking operations on Alephium. Users stake ALPH to receive
 * xALPH, manage unstaking with cooldown periods, and interact with the StakeVault
 * for governance and rewards.
 */
export class StakingModule extends ModuleBase {
  private config: StakingConfig
  private xAlphTokenContract: XAlphTokenInstance
  private stakeVaultContract: XAlphStakeVaultInstance

  constructor(scope: Powfi) {
    super({ scope, moduleName: 'StakingModule' })

    this.config = this.loadStakingConfig()
    this.xAlphTokenContract = XAlphToken.at(addressFromContractId(this.config.xAlphTokenId))
    this.stakeVaultContract = XAlphStakeVault.at(addressFromContractId(this.config.xAlphStakeVaultId))
  }

  /** Overrides the deployment addresses used by this module. */
  setConfig(config: StakingConfig): void {
    this.config = config
    this.xAlphTokenContract = XAlphToken.at(addressFromContractId(config.xAlphTokenId))
    this.stakeVaultContract = XAlphStakeVault.at(addressFromContractId(config.xAlphStakeVaultId))
  }

  /** Returns the current staking deployment configuration. */
  getConfig(): StakingConfig {
    return this.config
  }

  /** Returns the xALPH token contract instance. */
  getXAlphToken(): XAlphTokenInstance {
    return this.xAlphTokenContract
  }

  /** Returns the xALPH StakeVault contract instance. */
  getStakeVault(): XAlphStakeVaultInstance {
    return this.stakeVaultContract
  }

  /** Returns a RewardSharingVault contract instance for the given contract ID. */
  getRewardSharingVault(contractId: string): RewardSharingVaultInstance {
    return RewardSharingVault.at(addressFromContractId(contractId))
  }

  /** Returns a Governance contract instance for the given contract ID. */
  getGovernanceContract(contractId: string): GovernanceDemoInstance {
    return GovernanceDemo.at(addressFromContractId(contractId))
  }

  /** Fetches the live on-chain state of the xALPH token contract. */
  async getXAlphTokenState(): Promise<XAlphTokenTypes.State> {
    return this.xAlphTokenContract.fetchState()
  }

  /** Fetches the live on-chain state of the StakeVault contract. */
  async getStakeVaultState(): Promise<XAlphStakeVaultTypes.State> {
    return this.stakeVaultContract.fetchState()
  }

  /** Stakes ALPH and mints xALPH to the caller. */
  async stakeAlph(amount: bigint): Promise<XAlphTokenTypes.SignExecuteMethodResult<'stake'>> {
    this.ensurePositiveAmount(amount, 'Stake amount')
    return this.xAlphTokenContract.transact.stake({
      signer: this.scope.signer,
      args: { amount },
      attoAlphAmount: amount + MINIMAL_CONTRACT_DEPOSIT
    })
  }

  /** Burns xALPH and begins the unstaking cooldown period. */
  async startUnstake(amount: bigint): Promise<XAlphTokenTypes.SignExecuteMethodResult<'startUnstake'>> {
    this.ensurePositiveAmount(amount, 'Unstake amount')
    return this.xAlphTokenContract.transact.startUnstake({
      signer: this.scope.signer,
      args: { amount },
      tokens: [{ id: this.config.xAlphTokenId, amount }]
    })
  }

  /** Claims ALPH after the unstaking cooldown has elapsed. */
  async claimUnstaked(
    vaultIndex: bigint,
    amount: bigint
  ): Promise<XAlphTokenTypes.SignExecuteMethodResult<'claimUnstaked'>> {
    this.ensurePositiveAmount(amount, 'Claim amount')
    return this.xAlphTokenContract.transact.claimUnstaked({
      signer: this.scope.signer,
      args: {
        vaultIndex,
        amount
      }
    })
  }

  /** Cancels a pending unstake request and returns xALPH to the caller. */
  async cancelUnstake(vaultIndex: bigint): Promise<XAlphTokenTypes.SignExecuteMethodResult<'cancelUnstake'>> {
    return this.xAlphTokenContract.transact.cancelUnstake({
      signer: this.scope.signer,
      args: { vaultIndex },
      attoAlphAmount: DUST_AMOUNT
    })
  }

  /** Stakes xALPH into the StakeVault for governance participation and rewards. */
  async stakeXAlph(amount: bigint): Promise<XAlphStakeVaultTypes.SignExecuteMethodResult<'stake'>> {
    this.ensurePositiveAmount(amount, 'Stake amount')
    return this.stakeVaultContract.transact.stake({
      signer: this.scope.signer,
      args: { amount },
      tokens: [{ id: this.config.xAlphTokenId, amount }],
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
    })
  }

  /** Unstakes xALPH from the StakeVault. */
  async unstakeXAlph(amount: bigint): Promise<XAlphStakeVaultTypes.SignExecuteMethodResult<'unstake'>> {
    this.ensurePositiveAmount(amount, 'Unstake amount')
    return this.stakeVaultContract.transact.unstake({
      signer: this.scope.signer,
      args: { amount },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
    })
  }

  /** Unstakes xALPH from the StakeVault and starts the ALPH unstaking cooldown in one transaction. */
  async unlockAndStartUnstake(amount: bigint): Promise<ExecuteScriptResult> {
    return XAlphUnlockAndStartUnstake.execute({
      signer: this.scope.signer,
      initialFields: {
        xAlphToken: this.xAlphTokenContract.contractId,
        xAlphStakeVault: this.stakeVaultContract.contractId,
        amount
      },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
    })
  }

  /** Returns the unstake vault contract instance for a user at the given index. */
  getAlphUnstakeVault(userAddress: string, vaultIndex: bigint): AlphUnstakeVaultInstance {
    const userHex = binToHex(addressToBytes(userAddress))
    const indexHex = binToHex(codec.u256Codec.encode(vaultIndex))
    const contractId = subContractId(
      this.config.xAlphTokenId,
      `${userHex}${indexHex}`,
      groupOfAddress(this.config.xAlphTokenAddress)
    )
    return AlphUnstakeVault.at(addressFromContractId(contractId))
  }

  /** Fetches the live on-chain state of a user's unstake vault at the given index. */
  async getAlphUnstakeVaultState(userAddress: string, vaultIndex: bigint): Promise<AlphUnstakeVaultTypes.State> {
    const stakerAddress = this.getStakerAddress(userAddress)
    return this.getAlphUnstakeVault(stakerAddress, vaultIndex).fetchState()
  }

  /** Connects staked xALPH to a dapp contract, enabling it to use the caller's stake weight. */
  async connectToDapp(
    contractId: string,
    merkleProof: HexString
  ): Promise<XAlphStakeVaultTypes.SignExecuteMethodResult<'connectToDapp'>> {
    return this.stakeVaultContract.transact.connectToDapp({
      signer: this.scope.signer,
      args: { contractId, merkleProof },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
    })
  }

  /** Disconnects staked xALPH from a dapp contract. */
  async disconnectFromDapp(
    contractId: string
  ): Promise<XAlphStakeVaultTypes.SignExecuteMethodResult<'disconnectFromDapp'>> {
    return this.stakeVaultContract.transact.disconnectFromDapp({
      signer: this.scope.signer,
      args: { contractId },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
    })
  }

  /** Returns the user's staked xALPH amount and list of connected dapps. */
  async getUserStakeVaultInfo(address: string): Promise<StakeVaultUserInfo> {
    const stakerAddress = this.getStakerAddress(address)
    const result = await this.stakeVaultContract.view.getUserStakingInfo({
      args: { user: stakerAddress }
    })
    return {
      amount: result.returns.amount,
      connectedDapps: decodeContractIdList(result.returns.connectedDapps)
    }
  }

  /** Checks whether the user has an active stake in the StakeVault. */
  async isUserStaking(address: string): Promise<boolean> {
    const stakerAddress = this.getStakerAddress(address)
    const result = await this.stakeVaultContract.view.isStaking({ args: { user: stakerAddress } })
    return result.returns
  }

  /** Returns the user's governance weight based on their staked xALPH. */
  async getUserWeight(address: string): Promise<bigint> {
    const stakerAddress = this.getStakerAddress(address)
    const result = await this.stakeVaultContract.view.getWeight({ args: { user: stakerAddress } })
    return result.returns
  }

  /** Returns the indexes of the user's active (pending or claimable) unstake requests. */
  async getActiveUnstakeVaultIndexes(address: string): Promise<bigint[]> {
    const stakerAddress = this.getStakerAddress(address)
    const result = await this.xAlphTokenContract.view.getActiveUnstakeVaultIndexes({
      args: { caller: stakerAddress }
    })
    return decodeU256List(result.returns)
  }

  /** Returns the amount of ALPH that can be claimed from a specific unstake vault. */
  async getClaimableAmount(address: string, vaultIndex: bigint): Promise<bigint> {
    const stakerAddress = this.getStakerAddress(address)
    const result = await this.xAlphTokenContract.view.getClaimableAmount({
      args: { user: stakerAddress, vaultIndex }
    })
    return result.returns
  }

  /** Returns network-specific staking parameters such as cooldown duration and limits. */
  getSettings(): StakingSettings {
    return getStakingSettings(this.scope.network.id)
  }

  private loadStakingConfig(): StakingConfig {
    const networkId = this.scope.network.id
    try {
      const deployments = loadDeployments(networkId)
      const alphUnstakeVault = deployments.contracts.AlphUnstakeVault.contractInstance
      const xAlphToken = deployments.contracts.XAlphToken.contractInstance
      const stakeVault = deployments.contracts.XAlphStakeVault.contractInstance
      const rewardVault = deployments.contracts.RewardSharingVault.contractInstance
      const governance = deployments.contracts.GovernanceDemo.contractInstance
      return {
        groupIndex: stakeVault.groupIndex,
        alphUnstakeVaultTemplateId: alphUnstakeVault.contractId,
        xAlphTokenId: xAlphToken.contractId,
        xAlphTokenAddress: xAlphToken.address,
        xAlphStakeVaultId: stakeVault.contractId,
        xAlphStakeVaultAddress: stakeVault.address,
        rewardSharingTemplateId: rewardVault.contractId,
        governanceDemoTemplateId: governance.contractId
      }
    } catch (error) {
      this.logAndThrowError(`Failed to load staking deployments on ${networkId}`, error)
    }
  }

  private ensurePositiveAmount(amount: bigint, label: string): void {
    if (amount <= 0n) {
      throw new Error(`${label} must be greater than zero`)
    }
  }

  private getStakerAddress(address: string): string {
    if (isGrouplessAddressWithoutGroupIndex(address)) {
      return `${address}:${this.stakeVaultContract.groupIndex}`
    }
    return address
  }
}
