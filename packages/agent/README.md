# Agent domain package

`@animichi/agent` supplies platform-independent domain functions to the edge host. The root
entrypoint stays free of runtime schemas and SDK imports. Native tools and model composition
are explicit opt-in subpaths, `@animichi/agent/tools`, `@animichi/agent/models` and
`@animichi/agent/harness`. Public
exports run directly in Node and in a bundled Worker; this package has no deploy command,
bindings or storage.

```ts
import { localizedCityName, selectedRouteMessage } from "@animichi/agent";

localizedCityName("Uji", "ja"); // 宇治
selectedRouteMessage("en", 2); // Created a route with 2 selected stops.
```

## Current public modules

These retain-domain files from #1536 moved without changing their behavior. The old paths
below are relative to `workers/api/src/agent/`; no forwarding modules remain there.

| Old path | Current source | Responsibility |
|---|---|---|
| `memory/trusted-text.ts` | `src/trusted-text.ts` | Control characters and UTF-8 byte bounds |
| `session/status-value.ts` | `src/status-value.ts` | Status structure injection bounds |
| `egress/host-address.ts` | `src/host-address.ts` | Literal host/address classification |
| `tools/anitabi-image-proxy.ts` | `src/anitabi-image-proxy.ts` | Public screenshot URL projection |
| `tools/localized-city-name.ts` + `tools/city-names.json` | Same basenames under `src/` | Localized display names and unchanged corpus |
| `tools/title-variant-conflict.ts` | `src/title-variant-conflict.ts` | Wrong-season/title variant checks |
| `tools/web-source-tier.ts` | `src/web-source-tier.ts` | Domain-based web-source trust |
| `selection/selection-copy.ts` | `src/selection-copy.ts` | Localized deterministic outcomes |

## Native tools and credentials

`createPilgrimageHarness(options, context)` from `@animichi/agent/harness` registers the seven
native tools and returns the SDK's own `{ harness, open }` creation result. Models, Session,
tool context and other options retain their upstream types. Callers acquire `harness.lane`,
register native hooks and consume native Results directly; there is no execution facade.
Node tests use the same composition with `MemorySessionRepo`.

The seven domain tools are public `AgentHarnessTool` values, registered directly in
`AgentHarness.create({ tools, toolContext, session, models, model })`:

```ts
import { searchNearby, respond, createCatalogClient } from "@animichi/agent/tools";
import { createOperationModels } from "@animichi/agent/models";
```

| Export | External work | Replay |
|---|---|---|
| `resolveAnime` | Typed catalog title resolution | safe |
| `searchBangumi` | Typed catalog pilgrimage points | safe |
| `searchNearby` | Typed catalog geocoding and nearby points | safe |
| `planRoute` | Typed catalog itinerary calculation; no booking | safe |
| `webSearch` | Keyless DuckDuckGo HTML search through native fetch | safe |
| `translateAnimeTitle` | Curated catalog title, then optional native model completion | never |
| `respond` | Validates public response data; no external effect | safe |

Every execute rechecks authorization and an invocation-keyed quota reservation. The host owns
the reservation transaction and must make it idempotent. `invocationId` is the native result
entry ID; full search payloads live in `details`, and `readSearchResult` validates the entry,
current session and branch ancestry. `projectPilgrimage` derives clarification/current work
from committed entries. A route preserves offered point IDs and coordinates; `respond` needs
current-turn search/route evidence and validates before requesting native termination.

`createCatalogClient` returns the existing oRPC contract client with native request/response
validation, transient retries and bounded deadlines. `webSearch` uses `htmlparser2` for HTML
and entity parsing, preserves ranked source attribution, and bounds untrusted result text.
It keeps at most `WEB_SEARCH_PAGE_MAX_BYTES` (256 KiB) of the search response, counted in bytes as
they arrive, and parses only a body that fits. The chunk that would pass the limit has already been
handed over by the runtime but is neither decoded nor kept; the rest of the body is cancelled, best
effort, and the call fails as an unavailable backend does, so no part of a larger page is parsed.
Result text cannot end or reopen its `<untrusted_web_result>` wrapper. Before the byte bound, a
`<` followed by the tag's letters, in any case and with any other characters between them, is
recorded as `&#60;`; links arrive URL-serialised with `<` percent-encoded; other text is unchanged.
Each model request renders every successful `web_search` result from its recorded details through the
same escaping (`renderWebResults` from `@animichi/agent/harness`), so results recorded under an
earlier escaping reach the model escaped; a result whose details do not parse is withheld.
Provider/search failures use native SDK tool-error semantics; empty domain results remain data.

`createOperationModels(model, key, fetch?)` returns native `MutableModels`. It uses
`InMemoryCredentialStore`, `createModels` and `createProvider`; the public provider callbacks
enforce exact HTTPS provider hosts and refuse redirects. Ambient credentials and per-call
key/header/fetch overrides cannot replace the operation credential. Call `models.logout`
when the owning operation releases its credentials. Translation takes native `Models` and
`Model` values and returns actual supplemental consumption through `AgentToolResult.usage`,
with the payer recorded in domain details. No secondary usage accumulator exists.

Translation has one 85-second budget shared by catalog resolution and model fallback. Caller
cancellation propagates through the same native context. Completed model calls retain native
usage, including non-cancellation failures. Pi converts a cancelled tool execution to an error
without a usage result: its partial consumption is unknown, not zero. Cancellation settlement
and real eval composition remain acceptance work for #1550 and the eval integration stories.

## Migration boundary

The exhaustive historical source list and delete/rewrite obligations remain in
[the #1536 disposition](../../docs/iterations/production-readiness-2026-08/AGENT-FILE-DISPOSITION.md).
They are not copied here. The native Pi runtime switch (#1582, `b6cf74034`, 2026-09-11) replaced
the old engine and its consumers: production composes `createPilgrimageHarness` in
`workers/api/src/agent/host/session-agent.ts`, no path the disposition marks delete is left in
edge, and of its rewrite-domain paths only `workers/api/src/agent/byok/byok-credential.ts`,
`workers/api/src/agent/byok/byok-headers.ts`, `workers/api/src/agent/byok/byok-probe.ts` and
`workers/api/src/gateway/agent-turn.ts` remain.

The remaining retain-domain rules stay at their existing edge paths. The table records each
current consumer boundary and its owning card. Several leaves already run without platform
dependencies; their owners can relocate the plain rules when replacing those consumers.

| Path under `workers/api/src/agent/` | Current boundary / owner |
|---|---|
| `byok/byok-family.ts` | Browser/provider vocabulary still coupled to old credential construction; #1547 |
| `egress/egress-decision.ts` | Current guard's error class; native transport policy in #1547 |
| `egress/egress-policy.ts` | Current class-based guarded transport; #1547 |
| `egress/provider-allowlist.ts` | Current guard's policy object; #1547 |
| `egress/secret-scrub.ts` | Current credential scrubbing object; #1547 |
| `intake/anonymous-message-allowance.ts` | Edge identity and quota admission; #1546 |
| `intake/quota-reservation.ts` | Edge payer and business accounting; #1546 |

Node eval consumers import this public package: `packages/eval` depends on `@animichi/agent`
and has no `api` dependency. Node eval, conformance and test infrastructure must never
become production imports of this package or enter the Worker artifact.

## Verification

`pnpm lint`, `pnpm typecheck` and `pnpm test` are the same package scripts selected by local
and PR affected gates. Coverage is written to `coverage/lcov.info` and uploaded by the PR
matrix. Root type-aware lint includes this package explicitly. Edge has a real `workspace:*`
dependency, so pnpm's dependent closure selects its tests and the existing CD edge cohort.

The boundary test reads TypeScript's resolved graph and pnpm's consumer closure. Edge's
bundle smoke checks the production artifact graph and runs public domain behavior in workerd.
Separating package subpaths keeps existing pure-domain consumers free of the tools' Zod and
SDK modules; this is checked against parsed bundle inputs as well as emitted code.
