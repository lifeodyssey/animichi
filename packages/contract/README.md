# @seichijunrei/contract

Single source of truth for the types exchanged between the **Python Agent service** (client) and the **TS Catalog service** (server).

## What lives here

| File | Contents |
|---|---|
| `src/models.ts` | Zod schemas + inferred TS types: `PilgrimagePoint`, `TimedStop`, `TransitLeg`, `TimedItinerary`, `IngestResult`, `Route`, `Pacing`, `Origin` |
| `src/contract.ts` | oRPC contract + additional response types: `SearchResult`, `SpotsResult`, `NearbyResult` and the `catalogContract` object |
| `src/index.ts` | Re-exports everything above |

## Mirror architecture

```
packages/contract/src/models.ts   ← Zod schemas (source of truth)
         ↓  inferred types
catalog/src/types.ts               ← Worker-bundle mirror (pure TS interfaces, NO zod)
         ↓  import type only
catalog/src/router.ts, api/*.ts    ← Handlers use local types
```

### Parity guard

`catalog/test/contract-parity.worker.test.ts` asserts **mutual assignability** between every
contract inferred type and the catalog hand-mirror type at compile time (`tsc --noEmit`).
If either side drifts, `tsc` will fail before any tests run.

## Rules

### 1. `import type` only inside catalog (never a value import)

`catalog/src/types.ts` is a **type-only module** — pure `interface`/`type` declarations,
no `import` of runtime values, no zod. This ensures the zod runtime never enters the
Cloudflare Worker bundle. The parity test also uses `import type` exclusively.

```ts
// CORRECT — in catalog code and tests
import type { PilgrimagePoint } from "../../packages/contract/src/models";

// WRONG — pulls zod runtime into the Worker bundle
import { PilgrimagePoint } from "../../packages/contract/src/models";
```

### 2. Do NOT codegen Python models

The Python Agent client (`agent/clients/catalog_client.py`) mirrors the contract
shapes **by hand** and **intentionally diverges** via sentinel defaults:

| Field | Contract (optional) | Python sentinel |
|---|---|---|
| `episode` | `int \| undefined` | `-1` |
| `name_cn` | `string \| undefined` | `""` |
| `distance_m` | `number \| undefined` | `-1.0` |

Codegen from `openapi.json` would replace these sentinels with `Optional[...]` and
break downstream logic that pattern-matches on sentinel values (e.g. `episode == -1`
means "no episode data"). Keep the Python models **hand-written**.

### 3. No pnpm workspace (yet)

Until P5 wires up the pnpm workspace, catalog imports the contract via a relative path:

```ts
import type { ... } from "../../packages/contract/src/models";
```

After the workspace link lands, switch to `@seichijunrei/contract/models`.
