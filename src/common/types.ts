import type { SignerProvider, NetworkId } from '@alephium/web3';
import type { CpmmPoolState } from '../cpmm/types';
import type { ClmmPoolState } from '../clmm/types';

export interface Network {
  id: NetworkId;
  name: string;
  nodeUrl: string;
  explorerApiUrl: string;
  explorerUrl: string;
  tokenListUrl: string;
}

export const DEVNET = {
  id: 'devnet' as NetworkId,
  nodeUrl: 'http://127.0.0.1:22973',
  explorerApiUrl: 'http://localhost:9090',
  explorerUrl: 'http://localhost:23000',
  tokenListUrl: 'http://127.0.0.1:4000/token-list/devnet.json', // Temporary solution for devnet
  name: 'Devnet',
};

export const defaultNetworks: Network[] = [
  {
    id: 'mainnet',
    nodeUrl: 'https://node.mainnet.alephium.org',
    explorerApiUrl: 'https://backend.mainnet.alephium.org',
    explorerUrl: 'https://explorer.alephium.org',
    tokenListUrl:
      'https://raw.githubusercontent.com/alephium/token-list/master/tokens/mainnet.json',
    name: 'Mainnet',
  },
  {
    id: 'testnet',
    nodeUrl: 'https://node.testnet.alephium.org',
    explorerApiUrl: 'https://backend.testnet.alephium.org',
    explorerUrl: 'https://testnet.alephium.org',
    tokenListUrl:
      'https://raw.githubusercontent.com/alephium/token-list/master/tokens/testnet.json',
    name: 'Testnet',
  },
  DEVNET,
];
export type NetworkOverrides = Partial<Omit<Network, 'id'>>;

export interface ZetaLoadParams {
  networkId: NetworkId;
  signer?: SignerProvider;
  networkOverrides?: NetworkOverrides;
}

export interface PoolStatsItem {
  volume: number;
  volumeQuote: number;
  volumeFee: number;
  apr: number;
  feeApr: number;
  priceMin: number;
  priceMax: number;
  rewardApr: number[];
}
export interface PoolStats {
  feeRate: number;
  openTime: string;
  tvl: number;
  day: PoolStatsItem;
  week: PoolStatsItem;
  month: PoolStatsItem;
}

// Pool state + stats composites (no vendor-specific naming)
export type PoolState = CpmmPoolState | ClmmPoolState;
export type CpmmPoolStateWithStats = CpmmPoolState & PoolStats & { type: 'Standard' };
export type ClmmPoolStateWithStats = ClmmPoolState & PoolStats & { type: 'Concentrated' };
export type PoolStateWithStats = CpmmPoolStateWithStats | ClmmPoolStateWithStats;


