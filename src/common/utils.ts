import { isGrouplessAddressWithoutGroupIndex } from '@alephium/web3'

export function normalizeAddress(address: string, group: number): string {
  return isGrouplessAddressWithoutGroupIndex(address) ? `${address}:${group}` : address
}

export function sortTokens(tokenAId: string, tokenBId: string): [string, string] {
  return tokenAId < tokenBId ? [tokenAId, tokenBId] : [tokenBId, tokenAId]
}
