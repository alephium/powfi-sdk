# PowFi SDK (`@alephium/powfi-sdk`)

TypeScript SDK for PowFi on Alephium. This package provides high-level modules for CPMM, CLMM, staking, and token operations, and re-exports generated contract artifacts/deployments.

## Scope

- `PowFi` entrypoint for network/provider/signer configuration
- `powfi.cpmm` for constant-product liquidity pools
- `powfi.clmm` for concentrated-liquidity pools
- `powfi.staking` for xALPH staking flows
- `powfi.token` for token metadata helpers
- Re-exported contract types and deployment loaders from `clmm`, `cpmm`, and `staking`

## Installation

For SDK consumers:

```bash
npm install @alephium/powfi-sdk
```

For monorepo development:

```bash
bun install
```

## Quick Start

```ts
import { PowFi, CpmmModule } from '@alephium/powfi-sdk'

const powfi = PowFi.load({ networkId: 'testnet' })

const poolState = await powfi.cpmm.getPoolState(tokenAId, tokenBId)
const quote = CpmmModule.computeSwapAmount({
  state: poolState,
  tokenInId: tokenAId,
  tokenOutId: tokenBId,
  amountIn: 1_000_000n,
  slippageBps: 50n
})
```

CLMM simulation example:

```ts
const simulation = await powfi.clmm.simulateSwap({
  configIndex: 0n,
  token0,
  token1,
  zeroForOne: true,
  amount: 1_000_000n
})
```

For write operations (swap, add/remove liquidity, staking), pass a signer when loading the SDK:

```ts
const powfi = PowFi.load({ networkId: 'testnet', signer })
```

## Development Commands

Run inside `packages/sdk`:

```bash
bun run build
bun run test
bun run typecheck
bun run lint
bun run format:check
```

## Artifact Packaging

`bun run build` runs `copy-artifacts` before bundling. It copies:

- `../clmm/artifacts` and `../clmm/deployments`
- `../cpmm/artifacts` and `../cpmm/deployments`
- `../staking/artifacts` and `../staking/deployments`

into this package so the published SDK includes contract bindings and deployment metadata.

If contracts changed, rebuild contract artifacts first:

```bash
bun run compile
bun run build:sdk
```

## Related Packages

- [Monorepo README](../../README.md)
- [CLMM package](../clmm/README.md)
- [CPMM package](../cpmm/README.md)
- [Staking package](../staking/README.md)
