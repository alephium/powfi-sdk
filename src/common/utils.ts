import { ALPH_TOKEN_ID, DUST_AMOUNT, isGrouplessAddressWithoutGroupIndex } from '@alephium/web3'

/** Appends a group index to groupless addresses for on-chain lookups. */
export function normalizeAddress(address: string, group: number): string {
  return isGrouplessAddressWithoutGroupIndex(address) ? `${address}:${group}` : address
}

/** Returns two token IDs in deterministic (lexicographic) order, matching on-chain pool key derivation. */
export function sortTokens(tokenAId: string, tokenBId: string): [string, string] {
  return tokenAId < tokenBId ? [tokenAId, tokenBId] : [tokenBId, tokenAId]
}

/** Validates the optional integrator fee on a swap request and returns the fee amount, or 0n when no fee is set. */
export function validateIntegratorFee(params: {
  fee?: bigint
  feeRecipient?: string
  sender: string
  tokenInId: string
  amountIn: bigint
}): bigint {
  const { fee, feeRecipient, sender, tokenInId, amountIn } = params

  if (fee == null && feeRecipient == null) {
    return 0n
  }
  if (fee == null || feeRecipient == null) {
    throw new Error('fee and feeRecipient must be provided together')
  }
  if (fee <= 0n) {
    throw new Error('fee must be greater than 0')
  }
  if (feeRecipient === sender) {
    throw new Error('feeRecipient must differ from the sender')
  }
  if (tokenInId === ALPH_TOKEN_ID && fee < DUST_AMOUNT) {
    throw new Error(`an ALPH fee must be at least the dust amount ${DUST_AMOUNT}, got ${fee}`)
  }
  if (fee >= amountIn) {
    throw new Error(`fee must be less than the swapped amount ${amountIn}, got ${fee}`)
  }

  return fee
}
