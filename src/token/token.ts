import type { TokenInfo } from '@alephium/token-list'
import { ALPH_TOKEN_ID } from '@alephium/web3'
import ModuleBase from '../moduleBase'
import type { Powfi } from '../powfi'
import { TokenListFetchError } from '../common/error'

interface TokenCache {
  tokens: TokenInfo[]
  lastFetched: Date
}

type TokenListResponse = {
  tokens: TokenInfo[]
}

/** Fetches and caches token metadata from the Alephium token list. */
export class TokenModule extends ModuleBase {
  private cache?: TokenCache
  private readonly cacheTimeMs: number

  constructor(
    scope: Powfi,
    private readonly cacheTimeDays: number = 1
  ) {
    super({ scope, moduleName: 'TokenModule' })

    this.scope = scope
    this.cacheTimeMs = cacheTimeDays * 24 * 60 * 60 * 1000
  }

  /** Returns all tokens, using cache if valid, falling back to stale cache on fetch failure. */
  async getTokens(): Promise<TokenInfo[]> {
    if (this.isCacheValid()) {
      return this.cache!.tokens
    }

    try {
      return await this.fetchTokens()
    } catch (error) {
      if (this.cache) {
        const reason = error instanceof Error ? error.message : String(error)
        this.logInfo(`Failed to refresh token list, using cached copy. Reason: ${reason}`)
        return this.cache.tokens
      }
      this.logAndThrowError(`Failed to refresh token list`, error)
    }
  }

  /** Looks up a token by its on-chain ID; throws if not found. */
  async getTokenById(id: string): Promise<TokenInfo> {
    if (id === ALPH_TOKEN_ID) {
      return { id: ALPH_TOKEN_ID, decimals: 18, symbol: 'ALPH', name: 'Alephium', description: '', logoURI: '' }
    }
    const xAlphId = this.scope.staking.getConfig().xAlphTokenId
    if (id === xAlphId) {
      return { id: xAlphId, decimals: 18, symbol: 'xALPH', name: 'Staked ALPH', description: '', logoURI: '' }
    }

    const tokenInfo = await this.getTokenInfoBy((token) => token.id === id)
    if (!tokenInfo) {
      throw new Error(`Unknown token, id not found in token list: ${id}`)
    }
    return tokenInfo
  }

  /** Looks up a token by its ticker symbol; throws if not found. */
  async getTokenBySymbol(symbol: string): Promise<TokenInfo> {
    if (symbol === 'ALPH') {
      return { id: ALPH_TOKEN_ID, decimals: 18, symbol: 'ALPH', name: 'Alephium', description: '', logoURI: '' }
    }
    if (symbol === 'xALPH') {
      const xAlphId = this.scope.staking.getConfig().xAlphTokenId
      return { id: xAlphId, decimals: 18, symbol: 'xALPH', name: 'Staked ALPH', description: '', logoURI: '' }
    }

    const tokenInfo = await this.getTokenInfoBy((token) => token.symbol === symbol)
    if (!tokenInfo) {
      throw new Error(`Unknown token, symbol not found in token list: ${symbol}`)
    }
    return tokenInfo
  }

  /** Looks up a token by a custom predicate. */
  async getTokenInfoBy(fn: (token: TokenInfo) => boolean): Promise<TokenInfo | undefined> {
    const tokenInfos = await this.getTokens()
    return tokenInfos.find(fn)
  }

  async fetchTokens(): Promise<TokenInfo[]> {
    try {
      const response = await fetch(this.scope.tokenListUrl)

      if (!response.ok) {
        throw new TokenListFetchError(this.scope.tokenListUrl, { status: response.status })
      }
      const payload: unknown = await response.json()
      const tokens = this.extractTokens(payload)
      this.cache = {
        tokens,
        lastFetched: new Date()
      }

      return tokens
    } catch (error) {
      if (error instanceof TokenListFetchError) {
        this.logAndThrowError(`Failed to fetch token list`, error)
      }

      this.logAndThrowError(
        `Failed to fetch token list`,
        new TokenListFetchError(this.scope.tokenListUrl, {
          cause: error
        })
      )
    }
  }

  private isCacheValid(): boolean {
    if (!this.cache) {
      return false
    }

    const now = new Date()
    const timeDiff = now.getTime() - this.cache.lastFetched.getTime()
    return timeDiff < this.cacheTimeMs
  }

  private extractTokens(payload: unknown): TokenInfo[] {
    if (!this.validateTokenListResponse(payload)) {
      throw new Error('Invalid token list payload received from token list endpoint')
    }
    return payload.tokens
  }

  private validateTokenListResponse(value: unknown): value is TokenListResponse {
    if (typeof value !== 'object' || value === null) {
      return false
    }
    const tokens = (value as { tokens?: unknown }).tokens
    if (!Array.isArray(tokens)) {
      return false
    }
    return tokens.every((token) => this.validateTokenInfo(token))
  }

  private validateTokenInfo(value: unknown): value is TokenInfo {
    if (typeof value !== 'object' || value === null) {
      return false
    }

    const token = value as Partial<TokenInfo>

    const requiredStringFields: Array<keyof TokenInfo> = ['id', 'name', 'symbol', 'description', 'logoURI']

    if (requiredStringFields.some((field) => typeof token[field] !== 'string')) {
      return false
    }

    const { decimals, originChain, unchainedLogoURI } = token

    if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      return false
    }

    if (originChain !== undefined && typeof originChain !== 'string') {
      return false
    }

    if (unchainedLogoURI !== undefined && typeof unchainedLogoURI !== 'string') {
      return false
    }

    return true
  }
}
