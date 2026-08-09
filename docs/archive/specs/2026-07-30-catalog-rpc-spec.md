# catalog → WorkerEntrypoint RPC: zero HTTP surface

**Issue**: #540 · **Baseline**: `origin/main` @ `d6a8de8` · **Scope**: owner set this to the S1 round, all of catalog, not just `ingest`.

Evidence tags: **[measured]** = read from installed source with a file:line · **[docs]** = Cloudflare/oRPC official text · **[inferred]** = design judgement, not run.

---

## 0. Three corrections to the earlier investigation

**0.1 — "oRPC's `oc.route({method,path})` assumes HTTP, so `ingest` must leave the contract or the contract must grow a new capability." The premise is wrong.**

oRPC's HTTP-ness lives in the **handler**, not the contract. `@orpc/server` 1.14.8 ships two entry points with no HTTP at all: `createRouterClient` (`node_modules/@orpc/server/dist/index.d.mts:797`) and `call()` (`:787`). **[measured]** Both run the same procedure-client pipeline as the HTTP handler — zod input/output validation, the `.errors()` error map, `validateORPCError` — minus `Request`/`Response`.

**The contract needs zero changes.** See §2.

**0.2 — "Throw an exception across RPC and map it back to a status." This does not work and must not be the basis of the design.**

Cloudflare RPC preserves only an `Error`'s `message` and prototype `name`; **stack, custom subclasses, and all own properties — including `cause` — are lost.** **[docs: workers/runtime-apis/rpc/error-handling/]** `ORPCError`'s `code` / `status` / `data` / `defined` are *precisely* own properties (`node_modules/@orpc/client/dist/index.d.mts:111-117`) **[measured]**.

Throwing an `ORPCError` across the boundary drops every bit of classification information, leaving a bare string. Any design that then recovers meaning by string-matching is the worst kind of "passes for the wrong reason". Use a **discriminated result envelope** instead — §3.

**0.3 — `/catalog/img/:pointId` is unreachable through the root Worker. Confirmed.** `worker/app.ts` registers exactly: `GET /healthz` (:349), `/img/*` (:351 — the anitabi proxy, not catalog), `GET /catalog/public/anime-overview/:bangumiId` (:352), `app.all("/catalog/public/*") → notFound` (:355), `/v1/users/*` (:361), `/v1/*` (:362). **No `/catalog/img` forward exists.** **[measured]**

*Also found:* `apps/agent/agent/tests/api/test_live_api.py:11` documents `cd catalog`; the directory is `workers/catalog`. **[measured]**

---

## 1. Route → RPC method map

`workers/catalog/src/router.ts` exports **nine** procedures (`animeOverview` is one of them, not a separate Hono route) **[measured]**, plus two native Hono routes.

| today | RPC method | in | out | caller |
|---|---|---|---|---|
| `POST /catalog/search` | `CatalogInternal#search` | `SearchInput` | `RpcResult<SearchResult>` | Python agent |
| `POST /catalog/resolve` | `CatalogInternal#resolve` | `ResolveInput` | `RpcResult<ResolveOutcome>` | agent |
| `POST /catalog/points-by-work-id` | `CatalogInternal#pointsByWorkId` | `PointsByWorkIdInput` | `RpcResult<SearchResult>` | agent |
| `POST /catalog/spots` | `CatalogInternal#spots` | `SpotsInput` | `RpcResult<SpotsResult>` | agent |
| `POST /catalog/nearby` | `CatalogInternal#nearby` | `NearbyInput` | `RpcResult<NearbyResult>` | agent |
| `POST /catalog/geocode` | `CatalogInternal#geocode` | `GeocodeInput` | `RpcResult<GeocodeResult>` | agent |
| `POST /catalog/route` | `CatalogInternal#route` | `RouteInput` | `RpcResult<Route>` | agent |
| `POST /catalog/ingest` | `CatalogInternal#ingest` | `IngestInput` | `RpcResult<IngestResult>` | agent |
| `GET /catalog/public/anime-overview/{id}` | `CatalogPublic#animeOverview` | `{bangumi_id}` | `RpcResult<AnimeOverview>` | **root Worker** (`app.ts:352`), browser-facing |
| `GET /catalog/img/:pointId` | `CatalogPublic#image` | `pointId: string` | **`Response`** | none today |
| `GET /healthz` | `CatalogInternal#health` | – | `{status, service, env}` | §5 |

`animeOverview` differs from the internal procedures in **one** way: who builds the browser-facing `Response`. Today catalog's oRPC codec builds it and the root Worker passes it through (`forwardPublicCatalog`, `app.ts:65-67`). After: catalog returns data, the root Worker builds the `Response`. **catalog-side shape is identical to every other method.**

> ⚠️ **The easiest thing to lose.** catalog currently sets `Cache-Control: public, max-age=300, s-maxage=3600` on `/catalog/public/*` via middleware (`src/index.ts:26-32`) **[measured]**. That middleware disappears with Hono. **The root Worker must take the header over**, or edge caching on the public endpoint silently stops working — no error, just a cost and latency regression nobody notices.

### Why `image` returns `Response`, not `ReadableStream`

`Rpc.BaseType` (`@cloudflare/workers-types` 5.20260718.1, `experimental/index.ts:15147-15165`) **[measured]** includes `ReadableStream<Uint8Array>`, `Request`, **and `Response`**. `serveImage()` already returns a `Response` (`src/media/img.ts:53`) **[measured]**, carrying its own `Cache-Control` and tombstone fallback. Return it as-is: zero change, nothing to re-derive.

**Recommendation: build the method, leave it unreachable this round** — matching today's behaviour. Exposing it is a new public route and belongs to #550's image convergence, not to an RPC migration. Doing both at once means shipping a new public surface under cover of a refactor. **[inferred]**

---

## 2. The contract: change nothing

Versions: `@orpc/contract` **1.14.8**, `@orpc/server` **1.14.8**, `@orpc/openapi` 1.14.8 **[measured]**.

**Can a procedure be declared without an HTTP method/path?** Yes — every `Route` field is optional (`@orpc/contract/dist/shared/contract.TuRtB1Ca.d.mts:59-119`) **[measured]**. **But omitting `.route()` does not make it unreachable over HTTP — it substitutes defaults.** Both the OpenAPI route matcher (`@orpc/openapi/dist/shared/openapi.BB-W-NKv.mjs:133-134`) and the doc generator (`openapi.BwdtJjDu.mjs:538-539`) fall back to `DEFAULT_CONFIG = { defaultMethod: "POST", … }` (`@orpc/contract/dist/index.mjs:269-275`) **[measured]**. A `.route()`-less `ingest` becomes `POST /ingest` and still appears in `openapi.json`. That is a renamed URL, not RPC-only.

**So: keep the contract exactly as it is.** HTTP-ness is in the handler; delete the handler.

| asset | disposition |
|---|---|
| `packages/contract/src/contract.ts` | **unchanged**; still the cross-service source of truth |
| `.route({method, path})` declarations | **keep** — deleting them silently changes `openapi.json` paths. Their role demotes from routing config to documentation metadata |
| `errors.ts` / `pickCatalogErrors` | unchanged |
| `workers/catalog/src/router.ts` | unchanged (`implement(catalogContract)` as before) |
| `test/contract-parity.worker.test.ts` | **unchanged** — `import type` only; the `errorMap` it reads still exists **[measured]** |
| `test/router-shape-lock.type-test.ts` | unchanged |
| `scripts/emit-openapi.ts` | unchanged except the `description` fix below |
| `workers/catalog/src/index.ts` | Hono app + `OpenAPIHandler` deleted |
| `test/errors-wire.worker.test.ts` | must change — it constructs `new OpenAPIHandler(catalogRouter)` (`:34`) **[measured]**. Becomes the fixture producer, §4 |

### `openapi.json` and `api.animichi.com`

Stated honestly: **`openapi.json` already describes an API nobody can call.** Since #539 catalog has no public hostname in any environment (`wrangler.toml:23-24`) **[measured]**, so `POST https://<catalog>/catalog/search` has never been externally true. This change does not create that problem; it makes it impossible to keep ignoring.

For the `api.animichi.com` Swagger plan (#550):
- `openapi.json` is an **internal type reference, not a callable API**. Say so in `emit-openapi.ts`'s `info.description`; consider renaming the file.
- The spec that belongs on `api.animichi.com` describes **the root Worker's surface** — `/v1/*`, `/catalog/public/*` — and **that layer has no oRPC contract today** (`worker/app.ts` is hand-written Hono) **[measured]**.
- **Therefore: writing that contract is a follow-up, not something this issue can close.** Do the `description` fix here; open a card for the rest.

---

## 3. Error translation

### Transport shape

```ts
// workers/catalog/src/rpc/result.ts   (new)
import type { ORPCError } from "@orpc/server";

/** {defined, code, status, message, data} — identical to ORPCError.prototype.toJSON() */
export type ErrorEnvelope = ReturnType<ORPCError<any, any>["toJSON"]>;

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ErrorEnvelope };
```

`ORPCErrorJSON = Pick<ORPCError, 'defined'|'code'|'status'|'message'|'data'>` (`@orpc/client/dist/index.d.mts:118, :131`) **[measured]** — plain JSON, a legal `Rpc.Serializable`.

### Why the wire bytes are unchanged

Today the OpenAPI codec produces `{ status: error.status, body: serialize(error.toJSON()) }` (`openapi.BB-W-NKv.mjs:91-97`) **[measured]**. The root Worker then only has to write:

```ts
new Response(JSON.stringify(result.error), {
  status: result.error.status,
  headers: { "content-type": "application/json" },
});
```

Byte-equivalent. `_raise_for_error` → `parse_catalog_error` sees exactly what it sees today. **[inferred — pinned by §4's golden fixtures]**

### catalog side

```ts
export class CatalogInternal extends WorkerEntrypoint<Env> {
  async ingest(input: unknown): Promise<RpcResult<IngestResult>> {
    return guard(() => this.client().ingest(input));
  }
  // the other seven are structurally identical
}

async function guard<T>(fn: () => Promise<T>): Promise<RpcResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: toORPCError(e).toJSON() };
  }
}
```

`toORPCError(e)` = `e instanceof ORPCError ? e : new ORPCError("INTERNAL_SERVER_ERROR", …)` (`@orpc/client/dist/shared/client.DTC9NNUo.mjs:148-153`) **[measured]** — the same normalisation the HTTP handler does today (`server.ZxHCEN1h.mjs:101`) **[measured]**.

**Iron rule: `guard` catches everything.** Any throw that escapes arrives at the root Worker as a bare message, and the classification is gone.

### Translation table

| trigger | code | status | body | agent classification | same as today? |
|---|---|---|---|---|---|
| `route` too many points | `ROUTE_TOO_MANY_POINTS` | 400 | `{defined:true,…}` | `RouteTooManyPointsError`, no retry | ✅ |
| `route` too many clusters | `ROUTE_TOO_MANY_CLUSTERS` | 422 | ↑ | `RouteTooManyClustersError`, no retry | ✅ |
| `spots`/`animeOverview` empty | `WORK_NOT_FOUND` | 404 | ↑ | `WorkNotFoundError`, no retry | ✅ |
| upstream bangumi/anitabi down | `UPSTREAM_UNAVAILABLE` | 502 | ↑ | `TransientAPIError`, **retry** | ✅ |
| zod input rejection | `BAD_REQUEST` | 400 | `{defined:false,…}` | `APIError`, no retry | ✅ |
| uncaught inside catalog | `INTERNAL_SERVER_ERROR` | 500 | `{defined:false,…}` | `TransientAPIError`, **retry** | ✅ |
| DB not configured | (non-oRPC) | 503 | `{"error":"catalog database not configured"}` | `TransientAPIError`, retry | ✅ rebuild in root Worker |
| **RPC call itself throws** (catalog down / binding unavailable) | — | **503** | `{"error":"catalog unavailable"}` | `TransientAPIError`, retry | new; equivalent to today's `env.CATALOG.fetch()` failing |
| unknown path reaches the translator | — | 404 | — | no retry | ✅ (today's Hono `notFound`) |

Status values come from `packages/contract/src/errors.ts`'s `CATALOG_ERROR_DEFS` and its mirror `workers/catalog/src/lib/errors.ts:40-60` **[measured]**. **Not one number in this table is new — that is the design goal, not a coincidence.**

Agent-side retry entry point: `_is_retryable_response` (`catalog_client.py:370-375`) = `status >= 500 or status in {408, 429}` **[measured]**; `_status_fallback` uses the same rule **[measured]**.

### Does the agent change?

**No. Not one line.** This is an acceptance criterion: the translation layer is correct exactly when `apps/agent/agent/clients/` has an empty diff.

If implementation seems to require an agent change, **the translation layer is wrong — come back and redesign, do not change the agent.** The only acceptable exception is a docstring (`catalog_client.py:285-290` describes retry semantics), which is comment, not behaviour.

---

## 4. Making "agent retry behaviour is unchanged" observable

The most self-deceivable part of this work. Four layers; none optional.

### Layer 1 — Golden wire fixtures (**before touching any product code**)

On today's `origin/main`, drive the **existing `OpenAPIHandler`** across `{9 procedures} × {success, each applicable defined error, input-validation failure, internal throw}` and serialise `(status, content-type, body)` into a committed file:

```
packages/contract/fixtures/catalog-wire.json
```

`test/errors-wire.worker.test.ts` is already the seed of this harness — it calls `handler.handle` with a fake context and asserts on the envelope (`:34-47`) **[measured]**. Convert it into a fixture producer.

**The fixtures must be produced by the real router, never hand-written.** Hand-written fixtures record what you believe, not what the system does.

Give them non-trivial data: `null`s, absent optional fields, non-ASCII.

### Layer 2 — TS: replay the fixtures through the translator

In the root Worker's tests (plain node vitest; existing tests already inject a fake `Env.CATALOG` **[measured]**), with a fake entrypoint:

- returns `{ok:false, error: <fixture envelope>}` → assert the `Response` matches the fixture's `(status, content-type, body)` **byte for byte**
- returns `{ok:true, value: <fixture payload>}` → same
- **throws** → assert 503
- returns malformed data (`undefined`, missing `ok`) → assert 500, not a crash

### Layer 3 — Python: feed the *same* fixtures to the classifier

A new `apps/agent/agent/tests/unit/test_catalog_wire_fixtures.py` reads `catalog-wire.json` and asserts, per fixture:

```python
(type(parse_catalog_error(status, body, url)), _is_retryable_response(fake_response(status)))
```

against a hard-coded expectation table. Pure unit, no network, milliseconds.

**Why the three layers together equal the property:** Layer 1 defines "today's behaviour" as *data* rather than someone's memory. Layer 2 proves the translator's bytes equal that data. Layer 3 proves that data maps to asserted retry decisions. The agent can only observe `(status, body)` — so if those are unchanged, its behaviour *cannot* change. **This reduces an untestable property to byte equality.**

### Layer 4 — exhaustiveness locks

- every key of `catalogRouter` has a fixture, or fail
- every code in `CATALOG_ERROR_DEFS` has a fixture, or fail
- the public methods of `CatalogInternal` / `CatalogPublic` match `catalogRouter`'s keys, or fail

The last one turns "extending to other routes is mechanical" from a slogan into a compile-time constraint.

### What no unit test can cover

**That workerd actually round-trips this envelope across the RPC boundary.** Every mock assumes it does. Only `wrangler dev` or a real deploy proves it — §7 Step 5.

---

## 5. `/healthz`

**Measured:** catalog's `/healthz` has exactly one consumer — `test_live_api.py:31, 63`. A repo-wide `git grep healthz` **[measured]** shows `Dockerfile:43`, `Makefile:188-189`, `.claude/agents/tester.md:22` all hit the *agent's* `:8080/healthz`, and `apps/web/src/features/chat/config.ts:24` hits the backend base URL. **No CI, deploy script, or monitor touches catalog's.**

1. Keep a `CatalogInternal#health()` RPC method — cheap (no DB, as today), useful for diagnosis.
2. **Add no HTTP route.** catalog already has two health signals: `[observability] enabled = true` (`wrangler.toml`) **[measured]**, and "any agent call failing is itself the signal".
3. *Optional, owner's call:* the root Worker's existing `GET /healthz` (`app.ts:349`, hits the container) could fan out to `env.CATALOG.health()` + `env.USERS` and become the one whole-stack health surface. More useful than three independent healthz endpoints, but it is new public behaviour — **separate card.** **[inferred]**

---

## 6. Two entrypoints, not one and not three

| entrypoint | methods | bound by |
|---|---|---|
| `CatalogPublic` | `animeOverview`, `image` | the root Worker's browser path |
| `CatalogInternal` | the seven internal procedures + `ingest` + `health` | the root Worker's `catalogOutbound` (container path) |

**Not three (read/write split):** `search` itself triggers ingestion — `search.ts:200-207` and `work-points.ts:67-69` call `ingestWork()` directly **[measured]**. Isolating `ingest` as "the write" would be a **fake boundary**: whoever can call `search` can write to the database anyway. A fake security boundary is worse than none.

**Not one:** the binding *is* the capability boundary. With two, the root Worker's browser-facing path **cannot reach `ingest` or `search`, at the type level and at runtime**. That is free capability reduction, and it is the split Cloudflare's own docs suggest (one entrypoint per permission role).

**Cost:** `[[services]]` goes to two blocks per environment. The CATALOG service blocks are at `wrangler.toml:98` (top), `:185` (production), `:255` (staging, `service = "catalog-staging"`) **[measured]** — six blocks total. `entrypoint` is a valid `[[services]]` key **[docs]**.

**The default export.** For "zero HTTP surface" to mean anything, replace `export default app` (Hono) with a module worker that unconditionally returns 404. Then even if someone later flips `preview_urls` or adds a route, there is nothing to serve. `test/wrangler-private.worker.test.ts` **[measured]** should keep passing and may want extending to assert the default export serves nothing.

---

## 7. Implementation order

Each step is independently committable and verifiable. **The order is not interchangeable — Step 1 must precede any code change.**

**Step 1 — freeze the present** (no product code). Convert `test/errors-wire.worker.test.ts` into the producer of `packages/contract/fixtures/catalog-wire.json`, covering 9 procedures × all error branches.
*Verify:* `npm run test:worker` green; fixture committed; each status hand-checked against §3's table.

**Step 2 — lock the Python classifier** (no product code). Add `test_catalog_wire_fixtures.py`.
*Verify:* `uv run pytest` green. **Agent retry behaviour is now an executable assertion.**

**Step 3 — add the RPC surface, keep HTTP** (parallel period). New `src/rpc/result.ts` and `src/rpc/entrypoints.ts` exporting `CatalogInternal` / `CatalogPublic`, internally using `createRouterClient(catalogRouter, {context})`. Hono and `OpenAPIHandler` stay.
*Verify:* new worker tests import the entrypoint classes directly with a fake context and assert each method's `RpcResult` matches Step 1's fixtures. **This is where `createRouterClient`'s `defined:true` preservation is proven or disproven.**

**Step 4 — the root Worker translator.** `Env.CATALOG` type from `{fetch}` to the entrypoint service type; add `CATALOG_PUBLIC`; rewrite `catalogOutbound` as path→method dispatch + envelope→`Response`; `forwardPublicCatalog` goes through `CATALOG_PUBLIC.animeOverview` **and sets `Cache-Control` itself**; six `wrangler.toml` service blocks.
*Verify:* §4 Layer 2; existing `worker/entry.test.ts` assertions stay green.

**Step 5 — live verification (manual, before Step 6).** Local supabase + `wrangler dev` for catalog + root worker + agent; run a real ingest and search. **The only proof the envelope survives a real workerd RPC boundary.**
*Verify:* at least one success **and one real 502** (cut anitabi's network to produce it); confirm `catalog_defined_error` + `catalog_rpc_retry` in the agent's logs.

**Step 6 — remove the HTTP surface.** Delete the Hono app, `OpenAPIHandler`, `/catalog/img`, `/healthz`, and the `/catalog/public/*` cache middleware from `src/index.ts`; default export becomes 404-only.
*Verify:* `worker.worker.test.ts` will go red (it asserts `/catalog/*` returns 503) — restate it as 404-only.

**Step 7 — tidy.** Rewrite `test_live_api.py` (§8); fix `emit-openapi.ts`'s `info.description`; add §4 Layer 4's exhaustiveness locks.

**`packages/contract` needs no change at any step. If you find yourself editing it, stop.**

---

## 8. `test_live_api.py`

Four tests: three hit `CATALOG_URL` directly (`:61` healthz, `:69` ingest+search, `:80` nearby), one hits the agent (`:89`). `skip_no_stack` (`:35`) requires both reachable. **[measured]**

1. Drop `_reachable(CATALOG_URL)` from the skip guard; delete the `CATALOG_URL` constant. The guard keeps only the agent.
2. **Delete `test_catalog_healthz_ok`** — "catalog is alive" is implied by any successful agent call.
3. **Move `test_catalog_nearby_returns_sorted_points` to TS.** `workers/catalog` already runs `*.spike.test.ts` against real Postgres (testcontainers). A sorting assertion belongs there, not in a Python file HTTP-ing a TS service.
4. **Move `test_catalog_ingest_makes_work_searchable` into `ingest-orchestrator.spike.test.ts`** — that file exists **[measured]** and tests `ingestWork()` directly, closer to the truth than going through HTTP.
5. **Keep `test_agent_runtime_full_hybrid_chain`** — it is this file's actual value: agent → CatalogClient → root Worker → RPC → catalog → DB, the automated form of Step 5 and the only test covering real RPC serialisation.
6. Fix `:11`'s `cd catalog` → `cd workers/catalog`.

**Explicitly rejected: an `ENVIRONMENT === "development"` HTTP back door in catalog.** It makes the thing you test a different thing from the thing you deploy, and it is the same half-migrated state this issue exists to end — with a better excuse.

---

## 9. What the implementer must still judge

1. **Does `createRouterClient` actually preserve `defined: true`?** This is the load-bearing wall. If it downgrades defined errors to `INTERNAL_SERVER_ERROR`, the whole table in §3 collapses — and it collapses *asymmetrically*: `UPSTREAM_UNAVAILABLE` (the one retryable defined error) would become 500, which **still retries, so it looks fine**; but `WORK_NOT_FOUND` would become 500 and **start retrying when it must not**. Type signatures and the presence of `validateORPCError` **[measured]** suggest it holds; nothing was run. **Step 3's first assertion is this. If it fails, redesign — do not work around it.**

2. **Is success serialisation byte-identical?** The OpenAPI codec's `serialize(..., {outputFormat: "plain"})` (`openapi.BB-W-NKv.mjs:96`) **[measured]** may treat `Date`/`bigint`/`undefined` specially. `SearchResult.synced_at` is `z.string()` **[measured]**, but not all nine output types were field-checked. Step 1's fixtures expose this **only if they carry realistic data** — not empty arrays.

3. **`Response` body lifetime across the RPC boundary.** Type-legal **[measured]**, but who owns `waitUntil` for `serveImage`'s R2 stream across isolates, and whether a client disconnect leaks, is **unverified**. Deferring `/catalog/img` (§1) defers this risk; exposing it means owning this question.

4. **Two entrypoints or one.** Reasoned above, but it is architecture taste plus six `wrangler.toml` edits, and there may be deployment constraints not visible here (e.g. whether staging's `catalog-staging` service name supports multi-entrypoint binding).

5. **Is the `Cache-Control` migration complete?** The middleware also carries a "400 if query string present" check (`index.ts:28`) — and the root Worker has *its own copy* at `app.ts:353`. Whether to keep both or converge is visible on reading, and easy to get wrong on both sides at once.
