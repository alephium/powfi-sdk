export class PowFiSDKError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PowFiSDKError';
  }
}

export class InsufficientLiquidityError extends PowFiSDKError {
  constructor(message: string = 'Insufficient liquidity') {
    super(message);
    this.name = 'InsufficientLiquidityError';
  }
}

export class PriceImpactTooHighError extends PowFiSDKError {
  constructor(priceImpact: number, maxPriceImpact: number) {
    super(`Price impact too high: ${priceImpact.toFixed(2)}% > ${maxPriceImpact}%`);
    this.name = 'PriceImpactTooHighError';
  }
}

export class PoolNotFoundError extends PowFiSDKError {
  constructor(poolId: string) {
    super(`Pool does not exist for ${poolId}`);
    this.name = 'PoolNotFoundError';
  }
}

export class InsufficientBalanceError extends PowFiSDKError {
  constructor(token: string, required: string, available: string) {
    super(`Not enough ${token} balance. Required: ${required}, Available: ${available}`);
    this.name = 'InsufficientBalanceError';
  }
}

export class TokenListFetchError extends PowFiSDKError {
  public readonly status?: number;

  constructor(url: string, options?: { status?: number; cause?: unknown }) {
    const statusPart = options?.status !== undefined ? ` (status ${options.status})` : '';
    const errorOptions = options?.cause !== undefined ? { cause: options.cause } : undefined;
    super(`Failed to fetch token list from ${url}${statusPart}`, errorOptions);
    this.name = 'TokenListFetchError';
    this.status = options?.status;
  }
}
