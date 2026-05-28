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
  RewardFeeCollectorInstance,
  RewardFeeCollectorTypes,
  XAlphStakeVaultInstance,
  XAlphStakeVaultTypes,
  XAlphTokenInstance,
  XAlphTokenTypes,
  DistributorVaultTypes,
  DistributorVaultInstance
} from 'staking/artifacts/ts'
import {
  AlphUnstakeVault,
  GovernanceDemo,
  RewardSharingVault,
  RewardFeeCollector,
  XAlphStakeVault,
  XAlphToken,
  XAlphUnlockAndStartUnstake,
  DistributorVault,
  CollectProtocolCLMMToken
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
  private stakeVaultContract?: XAlphStakeVaultInstance

  constructor(scope: Powfi) {
    super({ scope, moduleName: 'StakingModule' })

    this.config = this.loadStakingConfig()
    this.xAlphTokenContract = XAlphToken.at(addressFromContractId(this.config.xAlphTokenId))
    if (this.config.xAlphStakeVaultId) {
      this.stakeVaultContract = XAlphStakeVault.at(addressFromContractId(this.config.xAlphStakeVaultId))
    }
  }

  /** Overrides the deployment addresses used by this module. */
  setConfig(config: StakingConfig): void {
    this.config = config
    this.xAlphTokenContract = XAlphToken.at(addressFromContractId(config.xAlphTokenId))
    if (config.xAlphStakeVaultId) {
      this.stakeVaultContract = XAlphStakeVault.at(addressFromContractId(config.xAlphStakeVaultId))
    }
  }

  /** Returns the current staking deployment configuration. */
  getConfig(): StakingConfig {
    return this.config
  }

  /** Returns the xALPH token contract instance. */
  getXAlphToken(): XAlphTokenInstance {
    return this.xAlphTokenContract
  }

  getRewardFeeCollector(contractId: string): RewardFeeCollectorInstance {
    return RewardFeeCollector.at(addressFromContractId(contractId))
  }

  getStakeVault(): XAlphStakeVaultInstance | undefined {
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

  getDistributorVaultId(token: string): string {
    return subContractId(
      this.config.feeCollectorId,
      token,
      groupOfAddress(addressFromContractId(this.config.feeCollectorId))
    )
  }

  async getXAlphTokenState(): Promise<XAlphTokenTypes.State> {
    return this.xAlphTokenContract.fetchState()
  }

  /** Fetches the live on-chain state of the StakeVault contract. */
  async getStakeVaultState(): Promise<XAlphStakeVaultTypes.State> {
    if (!this.stakeVaultContract) {
      throw new Error('Stake vault contract not initialized')
    }
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

  async donateReward(amount: bigint): Promise<XAlphTokenTypes.SignExecuteMethodResult<'depositReward'>> {
    this.ensurePositiveAmount(amount, 'Donate amount')
    return this.xAlphTokenContract.transact.depositReward({
      signer: this.scope.signer,
      args: { amount },
      attoAlphAmount: amount
    })
  }

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
      },
      attoAlphAmount: DUST_AMOUNT
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
    if (!this.stakeVaultContract) {
      throw new Error('Stake vault contract not initialized')
    }
    this.ensurePositiveAmount(amount, 'Stake amount')
    return this.stakeVaultContract.transact.stake({
      signer: this.scope.signer,
      args: { amount },
      tokens: [{ id: this.config.xAlphTokenId, amount }],
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
    })
  }

  async unstakeXAlph(amount: bigint): Promise<XAlphStakeVaultTypes.SignExecuteMethodResult<'unstake'>> {
    if (!this.stakeVaultContract) {
      throw new Error('Stake vault contract not initialized')
    }
    this.ensurePositiveAmount(amount, 'Unstake amount')
    return this.stakeVaultContract.transact.unstake({
      signer: this.scope.signer,
      args: { amount },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
    })
  }

  /** Unstakes xALPH from the StakeVault and starts the ALPH unstaking cooldown in one transaction. */
  async unlockAndStartUnstake(amount: bigint): Promise<ExecuteScriptResult> {
    if (!this.stakeVaultContract) {
      throw new Error('Stake vault contract not initialized')
    }
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
    if (!this.stakeVaultContract) {
      throw new Error('Stake vault contract not initialized')
    }
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
    if (!this.stakeVaultContract) {
      throw new Error('Stake vault contract not initialized')
    }
    return this.stakeVaultContract.transact.disconnectFromDapp({
      signer: this.scope.signer,
      args: { contractId },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
    })
  }

  /** Force disconnects from a dapp without invoking its unstake callback. */
  async disconnectFromDappWithoutUnstaking(
    contractId: string
  ): Promise<XAlphStakeVaultTypes.SignExecuteMethodResult<'disconnectFromDappWithoutUnstaking'>> {
    if (!this.stakeVaultContract) {
      throw new Error('Stake vault contract not initialized')
    }
    return this.stakeVaultContract.transact.disconnectFromDappWithoutUnstaking({
      signer: this.scope.signer,
      args: { contractId },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
    })
  }

  /** Returns the user's staked xALPH amount and list of connected dapps. */
  async getUserStakeVaultInfo(address: string): Promise<StakeVaultUserInfo> {
    if (!this.stakeVaultContract) {
      throw new Error('Stake vault contract not initialized')
    }
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
    if (!this.stakeVaultContract) {
      throw new Error('Stake vault contract not initialized')
    }
    const stakerAddress = this.getStakerAddress(address)
    const result = await this.stakeVaultContract.view.isStaking({ args: { user: stakerAddress } })
    return result.returns
  }

  /** Returns the user's governance weight based on their staked xALPH. */
  async getUserWeight(address: string): Promise<bigint> {
    if (!this.stakeVaultContract) {
      throw new Error('Stake vault contract not initialized')
    }
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

  async distributeRewards(
    contractId: string
  ): Promise<RewardFeeCollectorTypes.SignExecuteMethodResult<'distributeRewards'>> {
    return this.getRewardFeeCollector(contractId).transact.distributeRewards({
      signer: this.scope.signer,
      attoAlphAmount: DUST_AMOUNT
    })
  }

  async enableToken(token: string): Promise<RewardFeeCollectorTypes.SignExecuteMethodResult<'enableToken'>> {
    return this.getRewardFeeCollector(this.config.feeCollectorId).transact.enableToken({
      signer: this.scope.signer,
      args: { token },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT + DUST_AMOUNT
    })
  }

  async setRewardRate(newRate: bigint): Promise<RewardFeeCollectorTypes.SignExecuteMethodResult<'setRewardRate'>> {
    return this.getRewardFeeCollector(this.config.feeCollectorId).transact.setRewardRate({
      signer: this.scope.signer,
      args: { newRate }
    })
  }

  async setBurnRate(newRate: bigint): Promise<RewardFeeCollectorTypes.SignExecuteMethodResult<'setBurnRate'>> {
    return this.getRewardFeeCollector(this.config.feeCollectorId).transact.setBurnRate({
      signer: this.scope.signer,
      args: { newRate }
    })
  }

  getVault(token: string): DistributorVaultInstance {
    const vaultId = this.getDistributorVaultId(token)
    return DistributorVault.at(addressFromContractId(vaultId))
  }

  async getVaultState(token: string) {
    const vault = this.getVault(token)
    const state = await vault.fetchState()
    const balances = await this.scope.nodeProvider.addresses.getAddressesAddressBalance(vault.address)
    return {
      address: vault.address,
      id: vault.contractId,
      state,
      balances
    }
  }

  async collectProtocolFees(factoryId: string, lpToken: string, data: string): Promise<ExecuteScriptResult> {
    const vault = this.getVault(lpToken)
    return await vault.transact.collectProtocolFees({
      signer: this.scope.signer,
      args: {
        protocolFeeCollector: factoryId,
        data
      },
      attoAlphAmount: DUST_AMOUNT * 2n
    })
  }

  async collectProtocolFeesCLMM(
    factoryId: string,
    token0: string,
    token1: string,
    configIndex: bigint,
    tokenId: string
  ): Promise<ExecuteScriptResult> {
    return await CollectProtocolCLMMToken.execute({
      signer: this.scope.signer,
      initialFields: {
        collector: this.config.feeCollectorId,
        factory: factoryId,
        token0,
        token1,
        configIndex,
        tokenId
      },
      attoAlphAmount: DUST_AMOUNT * 2n
    })
  }
  async swapProtocolFeesCLMM(token: string, configIndex: bigint): Promise<ExecuteScriptResult> {
    const vault = this.getVault(token)
    return await vault.transact.swapFeesOnCLMM({
      signer: this.scope.signer,
      args: { tokenId: token, configIndex },
      attoAlphAmount: DUST_AMOUNT * 2n
    })
  }

  async swapProtocolFeesCPMM(lpToken: string, token: string): Promise<ExecuteScriptResult> {
    const vault = this.getVault(lpToken)
    return await vault.transact.swapFeesOnCPMM({
      signer: this.scope.signer,
      args: { tokenId: token },
      attoAlphAmount: DUST_AMOUNT * 2n
    })
  }

  async burnProtocolFeesCPMM(token0: string, token1: string): Promise<ExecuteScriptResult> {
    const lpTokenId = this.scope.cpmm.getPoolId(token0, token1)
    const vault = this.getVault(lpTokenId)
    return await vault.transact.burnFeesOnCPMM({
      signer: this.scope.signer,
      args: { token0, token1 },
      attoAlphAmount: DUST_AMOUNT * 2n
    })
  }

  async transferALPH(lpToken: string): Promise<ExecuteScriptResult> {
    const vault = this.getVault(lpToken)
    return await vault.transact.transferALPH({
      signer: this.scope.signer,
      attoAlphAmount: DUST_AMOUNT * 2n
    })
  }

  async migrateRewardFeeCollector(): Promise<RewardFeeCollectorTypes.SignExecuteMethodResult<'upgrade'>> {
    return this.getRewardFeeCollector(this.config.feeCollectorId).transact.upgrade({
      signer: this.scope.signer,
      args: { newBytecode: RewardFeeCollector.contract.bytecode }
    })
  }

  async setClmmFactoryId(
    factoryId: string
  ): Promise<RewardFeeCollectorTypes.SignExecuteMethodResult<'setClmmFactoryId'>> {
    return this.getRewardFeeCollector(this.config.feeCollectorId).transact.setClmmFactoryId({
      signer: this.scope.signer,
      args: { newId: factoryId }
    })
  }

  async setCpmmFactoryId(
    factoryId: string
  ): Promise<RewardFeeCollectorTypes.SignExecuteMethodResult<'setCpmmFactoryId'>> {
    return this.getRewardFeeCollector(this.config.feeCollectorId).transact.setCpmmFactoryId({
      signer: this.scope.signer,
      args: { newId: factoryId }
    })
  }

  async migrateDistributorVault(token: string): Promise<DistributorVaultTypes.SignExecuteMethodResult<'upgrade'>> {
    const vaultId = subContractId(
      this.config.feeCollectorId,
      token,
      groupOfAddress(addressFromContractId(this.config.feeCollectorId))
    )
    const vaultAddress = addressFromContractId(vaultId)
    const vault = DistributorVault.at(vaultAddress)
    return await vault.transact.upgrade({
      signer: this.scope.signer,
      args: { newCode: DistributorVault.contract.bytecode }
    })
  }

  async transferProtocolFees(fromToken: string, toToken: string): Promise<ExecuteScriptResult> {
    const fromVaultId = subContractId(
      this.config.feeCollectorId,
      fromToken,
      groupOfAddress(addressFromContractId(this.config.feeCollectorId))
    )
    const vault = DistributorVault.at(addressFromContractId(fromVaultId))
    return await vault.transact.transfer({
      signer: this.scope.signer,
      args: { tokenId: toToken },
      attoAlphAmount: DUST_AMOUNT * 2n
    })
  }

  async transferProtocolFeesALPH(fromToken: string): Promise<ExecuteScriptResult> {
    const fromVaultId = subContractId(
      this.config.feeCollectorId,
      fromToken,
      groupOfAddress(addressFromContractId(this.config.feeCollectorId))
    )
    const vault = DistributorVault.at(addressFromContractId(fromVaultId))
    return await vault.transact.transferALPH({
      signer: this.scope.signer,
      attoAlphAmount: DUST_AMOUNT * 2n
    })
  }

  getSettings(): StakingSettings {
    return getStakingSettings(this.scope.network.id)
  }

  private loadStakingConfig(): StakingConfig {
    const networkId = this.scope.network.id
    try {
      const deployments = loadDeployments(networkId)
      const alphUnstakeVault = deployments.contracts.AlphUnstakeVault.contractInstance
      const xAlphToken = deployments.contracts.XAlphToken.contractInstance
      const feeCollector = deployments.contracts.RewardFeeCollector.contractInstance

      const contracts = deployments.contracts as Record<
        string,
        { contractInstance: { contractId: string; address: string; groupIndex: number } }
      >
      const stakeVault = contracts.XAlphStakeVault?.contractInstance
      const rewardVault = contracts.RewardSharingVault?.contractInstance
      const governance = contracts.GovernanceDemo?.contractInstance

      return {
        groupIndex: stakeVault?.groupIndex ?? xAlphToken.groupIndex,
        alphUnstakeVaultTemplateId: alphUnstakeVault.contractId,
        xAlphTokenId: xAlphToken.contractId,
        xAlphTokenAddress: xAlphToken.address,
        feeCollectorId: feeCollector.contractId,
        xAlphStakeVaultId: stakeVault?.contractId,
        xAlphStakeVaultAddress: stakeVault?.address,
        rewardSharingTemplateId: rewardVault?.contractId,
        governanceDemoTemplateId: governance?.contractId
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
      const groupIndex = this.stakeVaultContract?.groupIndex ?? this.xAlphTokenContract.groupIndex
      return `${address}:${groupIndex}`
    }
    return address
  }
}
