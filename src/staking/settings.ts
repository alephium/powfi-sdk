import type { NetworkId } from '@alephium/web3'

export type StakingSettings = {
  unstakeDuration: bigint
  maxActiveUnstakeRequestsPerUser: bigint
  maxConnectedDapps: bigint
}

const defaultSettings: StakingSettings = {
  unstakeDuration: 30n * 24n * 60n * 60n * 1000n, // 30 days in milliseconds
  maxActiveUnstakeRequestsPerUser: 16n,
  maxConnectedDapps: 10n
}

const networkOverrides: Partial<Record<NetworkId, Partial<StakingSettings>>> = {
  devnet: {
    unstakeDuration: 60n * 1000n, // 1 minute
    maxConnectedDapps: 2n
  }
}

function buildSettings(networkId: NetworkId): StakingSettings {
  const overrides = networkOverrides[networkId]
  return {
    ...defaultSettings,
    ...(overrides ?? {})
  }
}

export const stakingSettingsByNetwork: Record<NetworkId, StakingSettings> = {
  mainnet: buildSettings('mainnet'),
  testnet: buildSettings('testnet'),
  devnet: buildSettings('devnet')
}

export function getStakingSettings(networkId: NetworkId): StakingSettings {
  return stakingSettingsByNetwork[networkId]
}
