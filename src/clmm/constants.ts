export const U256_MAX = 2n ** 256n - 1n

// Default "unlimited" amount for CLMM calculations
// This ensures the other amount is always the limiting factor
export const UNLIMITED_AMOUNT = 2n ** 128n - 1n // uint128 max

export { MAX_TICK, MIN_TICK } from 'clmm/artifacts/ts/constants'
