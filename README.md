# Powfi SDK (`@alephium/powfi-sdk`)

TypeScript SDK for Powfi on Alephium. This package provides high-level modules for CPMM, CLMM, staking, and token operations, and re-exports generated contract artifacts/deployments.

## Scope

- `Powfi` entrypoint for network/provider/signer configuration
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

For development:

```bash
bun install
```

## Quick Start

```ts
import { Powfi, CpmmModule } from '@alephium/powfi-sdk'

const powfi = Powfi.load({ networkId: 'testnet' })

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
const powfi = Powfi.load({ networkId: 'testnet', signer })
```

## Development Commands

```bash
bun run build
bun run test
bun run typecheck
bun run lint
bun run format:check
```

Integration tests expect a local Alephium devnet at `127.0.0.1:22973`:

```bash
docker compose -f docker/docker-compose.yml up -d
```

## Contract Artifacts

`clmm/`, `cpmm/` and `staking/` hold the generated contract bindings (`artifacts/`) and deployment metadata (`deployments/`) for the Powfi contracts. They are committed here and bundled into the published SDK.

After the contracts change, maintainers with access to the contracts repository refresh them from its compiled packages:

```bash
CONTRACTS_DIR=<path-to-contracts-repo>/packages bun run copy-artifacts
```

## License

[LGPL-3.0-only](./LICENSE)
