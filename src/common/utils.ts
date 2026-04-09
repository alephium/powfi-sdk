import { isGrouplessAddressWithoutGroupIndex } from '@alephium/web3'

/** Appends a group index to groupless addresses for on-chain lookups. */
export function normalizeAddress(address: string, group: number): string {
  return isGrouplessAddressWithoutGroupIndex(address) ? `${address}:${group}` : address
}

/** Returns two token IDs in deterministic (lexicographic) order, matching on-chain pool key derivation. */
export function sortTokens(tokenAId: string, tokenBId: string): [string, string] {
  return tokenAId < tokenBId ? [tokenAId, tokenBId] : [tokenBId, tokenAId]
}
