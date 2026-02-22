import type { SignerProvider, SignExecuteScriptTxResult } from '@alephium/web3';
import {
  ONE_ALPH,
  web3,
  addressFromContractId,
  stringToHex,
  binToHex,
  addressToBytes,
  codec,
  subContractId,
  groupOfAddress,
} from '@alephium/web3';
import { getSigners } from '@alephium/web3-test';
import {
  XAlphToken,
  XAlphStakeVault,
  AlphUnstakeVault,
  RewardSharingVault,
  type XAlphTokenInstance,
  type XAlphStakeVaultInstance,
  type AlphUnstakeVaultInstance,
} from 'staking/artifacts/ts';
import { buildMerkleWhitelist, type MerkleWhitelist } from 'staking/src/merkle-whitelist';
import { Zeta } from '../../../src/zeta';
import type { StakingConfig } from '../../../src/staking/types';

export const UNSTAKE_DURATION = 10n * 1000n; // 10 seconds for testing
export const MAX_ACTIVE_UNSTAKE_REQUESTS = 5n;
export const MAX_CONNECTED_DAPPS = 2n;
export const MAX_U256 = (1n << 256n) - 1n;
export const WEIGHT_SCALING_FACTOR = 10n ** 18n;

export interface Balances {
  alph: bigint;
  xalph: bigint;
}

export interface StakingState {
  totalDepositedAlph: bigint;
  totalXAlphSupply: bigint;
  lastUnstakeVaultIndex: bigint;
}

export interface StakeVaultState {
  totalStakedAmount: bigint;
}

export interface UnstakeVaultState {
  totalUnstakeAmount: bigint;
  withdrawnAmount: bigint;
  unstakeStartTime: bigint;
  unstakeDuration: bigint;
}

export async function getBalances(address: string, xAlphTokenId: string): Promise<Balances> {
  const balance = await web3.getCurrentNodeProvider().addresses.getAddressesAddressBalance(address);
  const xalphToken = balance.tokenBalances?.find((t) => t.id === xAlphTokenId);
  return {
    alph: BigInt(balance.balance),
    xalph: xalphToken ? BigInt(xalphToken.amount) : 0n,
  };
}

export function gasFee(txResult: SignExecuteScriptTxResult): bigint {
  return BigInt(txResult.gasAmount) * BigInt(txResult.gasPrice);
}

export function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Fixture {
  readonly zeta: Zeta;

  constructor(
    readonly xAlphTokenContract: XAlphTokenInstance,
    readonly stakeVaultContract: XAlphStakeVaultInstance,
    readonly deployer: SignerProvider,
    readonly whitelist: MerkleWhitelist,
    zeta: Zeta,
  ) {
    this.zeta = zeta;
  }

  get xAlphTokenId(): string {
    return this.xAlphTokenContract.contractId;
  }

  get stakeVaultId(): string {
    return this.stakeVaultContract.contractId;
  }

  static async create(): Promise<Fixture> {
    const [deployer] = await getSigners(1, 10_000n * ONE_ALPH);

    const zeta = new Zeta({ networkId: 'devnet', signer: deployer });
    zeta.setCurrentProviders();

    const unstakeVaultTemplate = (await AlphUnstakeVault.deployTemplate(deployer)).contractInstance;

    const xAlphTokenContract = (
      await XAlphToken.deploy(deployer, {
        initialFields: {
          symbol: stringToHex('XALPH'),
          name: stringToHex('Staked ALPH'),
          decimals: 18n,
          unstakeVaultTemplateId: unstakeVaultTemplate.contractId,
          maxActiveUnstakeRequestsPerUser: MAX_ACTIVE_UNSTAKE_REQUESTS,
          unstakeDuration: UNSTAKE_DURATION,
          totalDepositedAlph: 0n,
          totalXAlphSupply: 0n,
          lastUnstakeVaultIndex: 0n,
        },
        issueTokenAmount: MAX_U256,
      })
    ).contractInstance;

    const rewardSharingTemplate = (await RewardSharingVault.deployTemplate(deployer))
      .contractInstance;
    const templateState = await rewardSharingTemplate.fetchState();
    const codeHash = templateState.codeHash;

    const whitelist = await buildMerkleWhitelist([codeHash]);

    const stakeVaultContract = (
      await XAlphStakeVault.deploy(deployer, {
        initialFields: {
          stakeTokenId: xAlphTokenContract.contractId,
          maxConnectedDapps: MAX_CONNECTED_DAPPS,
          merkleRoot: whitelist.root,
          totalStakedAmount: 0n,
          owner: (await deployer.getSelectedAccount()).address,
        },
      })
    ).contractInstance;

    // Configure Zeta SDK to use the deployed contracts
    const stakingConfig: StakingConfig = {
      groupIndex: stakeVaultContract.groupIndex,
      alphUnstakeVaultTemplateId: unstakeVaultTemplate.contractId,
      xAlphTokenId: xAlphTokenContract.contractId,
      xAlphTokenAddress: xAlphTokenContract.address,
      xAlphStakeVaultId: stakeVaultContract.contractId,
      xAlphStakeVaultAddress: stakeVaultContract.address,
      rewardSharingTemplateId: rewardSharingTemplate.contractId,
      governanceDemoTemplateId: '', // Not needed for tests
    };
    zeta.staking.setConfig(stakingConfig);

    return new Fixture(xAlphTokenContract, stakeVaultContract, deployer, whitelist, zeta);
  }

  async stakeAlph(signer: SignerProvider, amount: bigint) {
    this.zeta.signer = signer;
    return this.zeta.staking.stakeAlph(amount);
  }

  async startUnstake(signer: SignerProvider, amount: bigint) {
    this.zeta.signer = signer;
    return this.zeta.staking.startUnstake(amount);
  }

  async claimUnstaked(signer: SignerProvider, vaultIndex: bigint, amount: bigint) {
    this.zeta.signer = signer;
    return this.zeta.staking.claimUnstaked(vaultIndex, amount);
  }

  async cancelUnstake(signer: SignerProvider, vaultIndex: bigint) {
    this.zeta.signer = signer;
    return this.zeta.staking.cancelUnstake(vaultIndex);
  }

  async stakeXAlph(signer: SignerProvider, amount: bigint) {
    this.zeta.signer = signer;
    return this.zeta.staking.stakeXAlph(amount);
  }

  async unstakeXAlph(signer: SignerProvider, amount: bigint) {
    this.zeta.signer = signer;
    return this.zeta.staking.unstakeXAlph(amount);
  }

  async stakeAndLockAlph(signer: SignerProvider, amount: bigint) {
    this.zeta.signer = signer;
    return this.zeta.staking.stakeAndLockAlph(amount);
  }

  async unlockAndStartUnstake(signer: SignerProvider, amount: bigint) {
    this.zeta.signer = signer;
    return this.zeta.staking.unlockAndStartUnstake(amount);
  }

  async getXAlphTokenState(): Promise<StakingState> {
    const state = await this.zeta.staking.getXAlphTokenState();
    return {
      totalDepositedAlph: state.fields.totalDepositedAlph,
      totalXAlphSupply: state.fields.totalXAlphSupply,
      lastUnstakeVaultIndex: state.fields.lastUnstakeVaultIndex,
    };
  }

  async getStakeVaultState(): Promise<StakeVaultState> {
    const state = await this.zeta.staking.getStakeVaultState();
    return {
      totalStakedAmount: state.fields.totalStakedAmount,
    };
  }

  async getActiveUnstakeVaultIndexes(signer: SignerProvider): Promise<bigint[]> {
    const account = await signer.getSelectedAccount();
    return this.zeta.staking.getActiveUnstakeVaultIndexes(account.address);
  }

  async getClaimableAmount(signer: SignerProvider, vaultIndex: bigint): Promise<bigint> {
    const account = await signer.getSelectedAccount();
    return this.zeta.staking.getClaimableAmount(account.address, vaultIndex);
  }

  async getUserStakingInfo(address: string): Promise<{ amount: bigint; connectedDapps: string[] }> {
    return this.zeta.staking.getUserStakeVaultInfo(address);
  }

  async isUserStaking(address: string): Promise<boolean> {
    return this.zeta.staking.isUserStaking(address);
  }

  async getUserWeight(address: string): Promise<bigint> {
    return this.zeta.staking.getUserWeight(address);
  }

  getUnstakeVaultAddress(userAddress: string, vaultIndex: bigint): string {
    const userHex = binToHex(addressToBytes(userAddress));
    const indexHex = binToHex(codec.u256Codec.encode(vaultIndex));
    const contractId = subContractId(
      this.xAlphTokenContract.contractId,
      `${userHex}${indexHex}`,
      groupOfAddress(this.xAlphTokenContract.address),
    );
    return addressFromContractId(contractId);
  }

  getUnstakeVault(userAddress: string, vaultIndex: bigint): AlphUnstakeVaultInstance {
    return this.zeta.staking.getAlphUnstakeVault(userAddress, vaultIndex);
  }

  async getUnstakeVaultState(userAddress: string, vaultIndex: bigint): Promise<UnstakeVaultState> {
    const state = await this.zeta.staking.getAlphUnstakeVaultState(userAddress, vaultIndex);
    return {
      totalUnstakeAmount: state.fields.totalUnstakeAmount,
      withdrawnAmount: state.fields.withdrawnAmount,
      unstakeStartTime: state.fields.unstakeStartTime,
      unstakeDuration: state.fields.unstakeDuration,
    };
  }

  async getBalances(address: string): Promise<Balances> {
    return getBalances(address, this.xAlphTokenId);
  }
}
