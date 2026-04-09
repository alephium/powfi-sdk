/** Base error class for all Powfi SDK errors. */
export class PowfiSDKError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PowfiSDKError'
  }
}

/** Thrown when a pool lacks sufficient liquidity for a swap or operation. */
export class InsufficientLiquidityError extends PowfiSDKError {
  constructor(message: string = 'Insufficient liquidity') {
    super(message)
    this.name = 'InsufficientLiquidityError'
  }
}

/** Thrown when a swap's price impact exceeds the allowed maximum. */
export class PriceImpactTooHighError extends PowfiSDKError {
  constructor(priceImpact: number, maxPriceImpact: number) {
    super(`Price impact too high: ${priceImpact.toFixed(2)}% > ${maxPriceImpact}%`)
    this.name = 'PriceImpactTooHighError'
  }
}

/** Thrown when a pool contract does not exist on-chain. */
export class PoolNotFoundError extends PowfiSDKError {
  constructor(poolId: string) {
    super(`Pool does not exist for ${poolId}`)
    this.name = 'PoolNotFoundError'
  }
}

/** Thrown when the user's token balance is insufficient for an operation. */
export class InsufficientBalanceError extends PowfiSDKError {
  constructor(token: string, required: string, available: string) {
    super(`Not enough ${token} balance. Required: ${required}, Available: ${available}`)
    this.name = 'InsufficientBalanceError'
  }
}

/** Thrown when fetching the token list from the remote endpoint fails. */
export class TokenListFetchError extends PowfiSDKError {
  public readonly status?: number

  constructor(url: string, options?: { status?: number; cause?: unknown }) {
    const statusPart = options?.status !== undefined ? ` (status ${options.status})` : ''
    const errorOptions = options?.cause !== undefined ? { cause: options.cause } : undefined
    super(`Failed to fetch token list from ${url}${statusPart}`, errorOptions)
    this.name = 'TokenListFetchError'
    this.status = options?.status
  }
}
