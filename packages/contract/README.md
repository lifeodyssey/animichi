# @seichijunrei/contract

Single source of truth for the types exchanged between the **Python Agent service** (client) and the **TS Catalog service** (server).

## What lives here

| File | Contents |
|---|---|
| `src/models.ts` | Zod schemas + inferred TS types: `PilgrimagePoint`, `TimedStop`, `TransitLeg`, `TimedItinerary`, `IngestResult`, `Route`, `Pacing`, `Origin` |
| `src/contract.ts` | oRPC contract + additional response types: `SearchResult`, `SpotsResult`, `NearbyResult` and the `catalogContract` object |
| `src/errors.ts` | Typed error registry: `CATALOG_ERROR_DEFS` (code → status/category/message/data schema), `ErrorCategory`, per-code data schemas, `pickCatalogErrors()` |
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

The Python Agent client (`apps/agent/agent/clients/catalog_client.py`) mirrors the contract
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

## Error contract

Errors cross the catalog → agent boundary as oRPC error envelopes. A thrown
`ORPCError` serializes (via `OpenAPIHandler`) to HTTP status = `error.status`
with the JSON body:

```json
{ "defined": true, "code": "ROUTE_TOO_MANY_CLUSTERS", "status": 422,
  "message": "Route exceeds the maximum number of areas",
  "data": { "cluster_count": 62, "max_clusters": 50 } }
```

`src/errors.ts` is the registry — one entry per code:

| Field | Meaning |
|---|---|
| `code` | String-literal error code, the cross-service identity of the failure |
| `status` | HTTP status the envelope travels on |
| `category` | `user_actionable` \| `retryable` \| `system` — drives client behavior |
| `message` | Static default message (safe, English, for logs/debugging — never shown to users) |
| `data` | Zod schema for the structured parameters carried by the error |

### Categories drive behavior

| Category | Client behavior |
|---|---|
| `user_actionable` | Do NOT retry. Map the code + `data` to localized guidance the user can act on (e.g. "narrow your selection to at most 50 areas"). |
| `retryable` | Transient infra/upstream failure. Retry with backoff; if exhausted, tell the user to try again shortly. |
| `system` | Our-side fault. Do NOT retry. Show a generic apology; alert via logs. |

`category` is intentionally **not on the wire**. Each client derives it from
`code` via its own mirror table, so a compromised or buggy server cannot flip a
client into unexpected behavior.

### Trust boundary (SD-19)

The envelope `message` is **untrusted upstream content**. Clients may log it,
but must never show it to users, embed it in LLM prompts, or store it on
exception `str()`. All user-visible text comes from the client's own mapping
table (`apps/agent/agent/agents/error_messages.py`), built from `code` +
validated `data`.

### Three mirrors, one registry

```
packages/contract/src/errors.ts        ← registry (zod, source of truth)
workers/catalog/src/lib/errors.ts      ← Worker mirror (no zod) + ORPCError constructors
apps/agent/agent/clients/catalog_errors.py ← Python mirror: envelope parser → typed exceptions
apps/agent/agent/agents/error_messages.py  ← user-facing localized messages (ja/zh/en)
```

Parity between the contract and the Worker mirror is enforced at compile time
by `workers/catalog/test/contract-parity.worker.test.ts`; the Python mirror is
pinned by `apps/agent/agent/tests/unit/test_catalog_errors.py`.

### Adding a new error code (checklist for stories)

1. **Contract** — in `src/errors.ts`: add the zod `data` schema and the
   `CATALOG_ERROR_DEFS` entry (`status`, `category`, `message`, `data`). Attach
   it to the owning procedure in `src/contract.ts` via
   `.errors(pickCatalogErrors([...]))`. Run `pnpm emit:openapi` and commit the
   regenerated `openapi.json`.
2. **Catalog worker** — mirror the entry in `workers/catalog/src/lib/errors.ts`
   (interface + `CATALOG_ERRORS` entry + a typed constructor that sets
   `defined: true`). Throw it at the site. Extend the parity assertions in
   `test/contract-parity.worker.test.ts` and add a wire-shape test in
   `test/errors-wire.worker.test.ts`.
3. **Agent client** — mirror in `apps/agent/agent/clients/catalog_errors.py`:
   data model (defaults for every field — wire data is untrusted), exception
   class (subclass `TransientAPIError` too iff category is `retryable`), and
   the code → builder registry entry. Pin it in
   `apps/agent/agent/tests/unit/test_catalog_errors.py`.
4. **User messages** — add ja/zh/en templates to
   `apps/agent/agent/agents/error_messages.py`, formatted only from the typed
   exception's fields.
5. **Pick the category deliberately**: can the user change something to make
   the call succeed? → `user_actionable`. Would an identical retry plausibly
   succeed? → `retryable`. Otherwise → `system`.

Never throw a bare `ORPCError("BAD_REQUEST", ...)` / plain `Error` for a
failure the agent or the user is expected to react to — register a code.
