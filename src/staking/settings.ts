import type { NetworkId } from '@alephium/web3'

export type StakingSettings = {
  unstakeDuration: bigint
  maxActiveUnstakeRequestsPerUser: bigint
  maxConnectedDapps: bigint
}

const mainnet: StakingSettings = {
  unstakeDuration: 30n * 24n * 60n * 60n * 1000n, // 30 days in milliseconds
  maxActiveUnstakeRequestsPerUser: 16n,
  maxConnectedDapps: 10n
}

export const stakingSettingsByNetwork: Record<NetworkId, StakingSettings> = {
  mainnet,
  testnet: { ...mainnet },
  devnet: {
    ...mainnet,
    unstakeDuration: 60n * 1000n, // 1 minute
    maxConnectedDapps: 2n
  }
}

export function getStakingSettings(networkId: NetworkId): StakingSettings {
  return stakingSettingsByNetwork[networkId]
}
