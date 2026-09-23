import type { SignerProvider } from '@alephium/web3'
import { ONE_ALPH, web3, stringToHex, MINIMAL_CONTRACT_DEPOSIT } from '@alephium/web3'
import { getSigners } from '@alephium/web3-test'
import {
  XAlphToken,
  AlphUnstakeVault,
  RewardFeeCollector,
  DistributorVault,
  ALPHLock,
  type XAlphTokenInstance
} from 'staking/artifacts/ts'
import { Powfi } from '../../../src/powfi'
import type { StakingConfig } from '../../../src/staking/types'

export const UNSTAKE_DURATION = 10n * 1000n // 10 seconds for testing
export const MAX_ACTIVE_UNSTAKE_REQUESTS = 5n
export const MAX_U256 = (1n << 256n) - 1n

export interface Balances {
  alph: bigint
  xalph: bigint
}

export interface UnstakeVaultState {
  totalUnstakeAmount: bigint
  withdrawnAmount: bigint
  unstakeStartTime: bigint
  unstakeDuration: bigint
}

export async function getBalances(address: string, xAlphTokenId: string): Promise<Balances> {
  const balance = await web3.getCurrentNodeProvider().addresses.getAddressesAddressBalance(address)
  const xalphToken = balance.tokenBalances?.find((t) => t.id === xAlphTokenId)
  return {
    alph: BigInt(balance.balance),
    xalph: xalphToken ? BigInt(xalphToken.amount) : 0n
  }
}

export function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class Fixture {
  readonly powfi: Powfi

  constructor(
    readonly xAlphTokenContract: XAlphTokenInstance,
    readonly deployer: SignerProvider,
    powfi: Powfi
  ) {
    this.powfi = powfi
  }

  get xAlphTokenId(): string {
    return this.xAlphTokenContract.contractId
  }

  static async create(unstakeDuration: bigint = UNSTAKE_DURATION): Promise<Fixture> {
    const [deployer] = await getSigners(1, 20n * ONE_ALPH)
    const powfi = new Powfi({ networkId: 'devnet', signer: deployer })
    return this.load(powfi, unstakeDuration)
  }

  static async load(powfi: Powfi, unstakeDuration: bigint = UNSTAKE_DURATION): Promise<Fixture> {
    const deployer = powfi.signer
    const deployerAddress = (await deployer.getSelectedAccount()).address

    powfi.setCurrentProviders()

    const unstakeVaultTemplate = (await AlphUnstakeVault.deployTemplate(deployer)).contractInstance

    const xAlphTokenContract = (
      await XAlphToken.deploy(deployer, {
        initialFields: {
          symbol: stringToHex('XALPH'),
          name: stringToHex('Staked ALPH'),
          decimals: 18n,
          unstakeVaultTemplateId: unstakeVaultTemplate.contractId,
          maxActiveUnstakeRequestsPerUser: MAX_ACTIVE_UNSTAKE_REQUESTS,
          unstakeDuration: unstakeDuration,
          totalDepositedAlph: 0n,
          totalXAlphSupply: 0n,
          lastUnstakeVaultIndex: 0n
        },
        issueTokenAmount: MAX_U256
      })
    ).contractInstance

    const distributorVaultTemplate = (await DistributorVault.deployTemplate(deployer)).contractInstance
    const alphLock = (await ALPHLock.deploy(deployer, { initialFields: {} })).contractInstance

    const feeCollectorContract = (
      await RewardFeeCollector.deploy(deployer, {
        initialFields: {
          owner: deployerAddress,
          xAlph: xAlphTokenContract.contractId,
          distributorVaultTemplateId: distributorVaultTemplate.contractId,
          locker: alphLock.contractId,
          lastUpdate: 0n,
          rewardRate: 0n,
          burnRate: 0n,
          clmmFactoryId: '',
          cpmmFactoryId: '',
          treasuryRate: 0n,
          treasury: deployerAddress
        },
        issueTokenAmount: 1n,
        issueTokenTo: deployerAddress
      })
    ).contractInstance

    // Configure Powfi SDK to use the deployed contracts
    const stakingConfig: StakingConfig = {
      groupIndex: xAlphTokenContract.groupIndex,
      alphUnstakeVaultTemplateId: unstakeVaultTemplate.contractId,
      xAlphTokenId: xAlphTokenContract.contractId,
      xAlphTokenAddress: xAlphTokenContract.address,
      feeCollectorId: feeCollectorContract.contractId
    }
    powfi.staking.setConfig(stakingConfig)

    return new Fixture(xAlphTokenContract, deployer, powfi)
  }

  async stakeAlph(signer: SignerProvider, amount: bigint) {
    this.powfi.signer = signer
    return this.powfi.staking.stakeAlph(amount)
  }

  async startUnstake(signer: SignerProvider, amount: bigint) {
    this.powfi.signer = signer
    return this.powfi.staking.startUnstake(amount)
  }

  async claimUnstaked(signer: SignerProvider, vaultIndex: bigint, amount: bigint) {
    this.powfi.signer = signer
    return this.powfi.staking.claimUnstaked(vaultIndex, amount)
  }

  async getActiveUnstakeVaultIndexes(signer: SignerProvider): Promise<bigint[]> {
    const account = await signer.getSelectedAccount()
    return this.powfi.staking.getActiveUnstakeVaultIndexes(account.address)
  }

  async getClaimableAmount(signer: SignerProvider, vaultIndex: bigint): Promise<bigint> {
    const account = await signer.getSelectedAccount()
    return this.powfi.staking.getClaimableAmount(account.address, vaultIndex)
  }

  async getUnstakeVaultState(userAddress: string, vaultIndex: bigint): Promise<UnstakeVaultState> {
    const state = await this.powfi.staking.getAlphUnstakeVaultState(userAddress, vaultIndex)
    return {
      totalUnstakeAmount: state.fields.totalUnstakeAmount,
      withdrawnAmount: state.fields.withdrawnAmount,
      unstakeStartTime: state.fields.unstakeStartTime,
      unstakeDuration: state.fields.unstakeDuration
    }
  }

  async setupFeeCollector(params: { clmmFactoryId: string; cpmmFactoryId: string }) {
    const deployerAccount = await this.deployer.getSelectedAccount()
    const deployerAddress = deployerAccount.address

    const lockerDeploy = await ALPHLock.deploy(this.deployer, {
      initialFields: {},
      initialAttoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
    })
    const lockerId = lockerDeploy.contractInstance.contractId

    const vaultTemplateDeploy = await DistributorVault.deployTemplate(this.deployer)
    const vaultTemplateId = vaultTemplateDeploy.contractInstance.contractId

    const rewardCollectorDeploy = await RewardFeeCollector.deploy(this.deployer, {
      initialFields: {
        owner: deployerAddress,
        xAlph: this.xAlphTokenId,
        distributorVaultTemplateId: vaultTemplateId,
        locker: lockerId,
        lastUpdate: BigInt(Date.now()),
        rewardRate: 0n,
        burnRate: 0n,
        clmmFactoryId: params.clmmFactoryId,
        cpmmFactoryId: params.cpmmFactoryId,
        treasuryRate: 0n,
        treasury: deployerAddress
      },
      initialAttoAlphAmount: MINIMAL_CONTRACT_DEPOSIT + 1n * ONE_ALPH,
      issueTokenAmount: 1n,
      issueTokenTo: deployerAddress
    })
    const rewardCollector = rewardCollectorDeploy.contractInstance

    this.powfi.staking.setConfig({
      ...this.powfi.staking.getConfig(),
      feeCollectorId: rewardCollector.contractId
    })

    return rewardCollector
  }

  async getBalances(address: string): Promise<Balances> {
    return getBalances(address, this.xAlphTokenId)
  }
}
