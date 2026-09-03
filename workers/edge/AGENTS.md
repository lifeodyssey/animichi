# workers/edge — AGENTS.md

TypeScript Cloudflare Worker (Hono + `@cloudflare/containers`): the **request gateway**. Owns
identity/rate-limit/turnstile enforcement, routing + forwarding to Catalog / Users / the agent
container, and the image/tile proxies. **No pilgrimage domain model** — it is Gateway tier, never
`src/domain/`. The HTML surface lives in `apps/web`.
Root guide: `../../AGENTS.md`. Sibling worker guides: `../catalog/AGENTS.md`, `../users/AGENTS.md`.

## Commands (from `workers/edge/`)

- pnpm. `pnpm test` — the node:test suite under `test/*.test.ts` (doubles in `test/doubles/`).
  From the repo root the same suite is `pnpm run test:worker` (forwards to
  `pnpm --filter edge-worker test`; `make test-worker` likewise) — command surface unchanged.
- `pnpm run test:bundle-smoke` — the W0-S3 bundler smoke gate (#1246): bundles
  `bundle-smoke/pi-kernel.worker.ts` with wrangler's own esbuild settings and **executes** the
  artifact in workerd. Separate from `pnpm test` on purpose — it is the only gate that can see
  bundle-only runtime failures, and it is slower than the node:test suite.
- `pnpm run test:catalog-api` — opt-in staging lane (`api-test/*.test.ts`, W1-4 #1253) for the
  catalog tools, against a deploy carrying `AGENT_TURN_ROUTE = "edge"`. Two halves: the five
  catalog procedures still have no public door (spec Appendix D), and one real `POST /v1/chat`
  through the deployed edge calls `resolve_anime` and is readable back by conversation id — the
  (api) evidence #1253 had to defer until the route switch. Fails closed without
  `CATALOG_API_ORIGIN` + `AGENT_TURN_BEARER`; never in CI. Why the turn is signed in and the
  anonymous journey is manual: `api-test/README.md` and `docs/ops/w1-staging-journey.md`.
- `pnpm run test:spike-db` — opt-in lane (`db-test/*.test.ts`) that runs the W0-S4 spike's run
  store against a **real** PostgreSQL named by `SPIKE_TEST_DATABASE_URL`. Never in CI and never
  against staging; it fails closed without a disposable database. Recipe: `spike/pi/README.md`.
- `pnpm run test:agent-db` — the agent-tier database arm (#1251, #1252): boots a disposable
  PostgreSQL container itself, applies the committed `migrations/neon` chain, and runs the
  intake's own statements against it. Its own directory and lane, not the spike's: this one
  brings its own database (Docker + the offline `animichi-test-postgres` image,
  `agent-db-test/README.md`) and outlives W0. It is the only lane that can answer for a partial
  unique index or a transaction rollback. Not yet in `gate_edge` — run it by hand before pushing
  agent-tier changes; see that README for what wiring it into CI would cost.
- `pnpm run typecheck` — `tsc --noEmit` (TypeScript 7.0.2 via workspace hoist).
- `pnpm run lint:oxlint` — type-aware oxlint, warnings denied.
- Deploy is CI-only: `wrangler deploy -c workers/edge/wrangler.toml` from the repo root
  (hook `block-local-deploy`). Never deploy locally.

## Layout (2026-08-06-edge-gateway-structure-design.md)

- `src/entry.ts` — Worker default export + `RuntimeContainer`; `src/app.ts` — Hono assembly only.
- `src/db/` — Drizzle mapping of the agent turn tables the edge owns from W1 (`messages`,
  `runs`, `run_steps`, plus `sessions` for the retrieval's ownership check); query-only
  metadata, never a DDL authority (`migrations/neon` owns the schema).
- `src/agent/` — the agent turn tier (W1, spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md`):
  `intake/` (one `POST /v1/chat` becomes one transaction: message + `running` run + quota
  reservation, then `setAlarm(now)` on the session), `session/` (the `AgentSession` DO and the
  turn it runs inside its own `alarm()` handler, #1252: the run state machine, the
  `(run_id, step_index)` step replay, the transcript rebuild, the pi/mimo assembly, the SD-9
  frames and the in-memory subscriber set), `sweeper/` (the singleton `RunSweeper` DO, the
  at-least-once backstop), `settlement/` (how a turn ENDS: the run's terminal row, its
  `daily_usage` rollup and its quota refund, called by the session on its own transaction
  alongside the assistant message), `retrieval/` (how a turn is READ BACK:
  `ConversationRetrieval`, the owned and ordered transcript page plus the latest run's status
  behind `GET /v1/conversations/:id/messages` — spec §二's disconnect semantics, and the only
  agent-tier read that never runs inside the Durable Object), `tools/` (the four catalog tools
  the model calls, #1253).
  Ports live with the use case, Neon adapters beside them, and
  no module here imports `cloudflare:workers` so the node:test suite can load every one of them.
  How a turn ANSWERS is `src/agent/session/turn-answer.ts` (#1283): the model ends its turn by calling one
  `respond` tool — the pi-native mechanism, argued and measured in that file's header — and the
  server derives the intent from its own stored results, projecting the `data-response` part in
  `src/agent/session/turn-answer-part.ts`. That part is both the SD-9 frame the stream pushes and the
  `messages.response_data` the settlement commits, so `retrieval/` publishes the same intent a
  connected client already saw.
  The `Toolbox` port in `src/agent/session/turn-toolbox.ts` is the whole contract with #1253's
  `src/agent/tools/`, and `session-turn.ts::turnToolbox` is what fulfils it: the four catalog
  tools over the private `CATALOG` binding, bound to one `TurnCatalogSession`. An environment
  without that binding still runs — the turn just has no tools. What routes traffic here is the
  `AGENT_TURN_ROUTE` flag (#1256): `"edge"` serves `POST /v1/chat` and
  `GET /v1/conversations/{id}/messages` from this tier, anything else (including unset) forwards
  both to the Python container as before. staging = `edge`, production and `wrangler dev` =
  `container`; the rollback is that one word in `wrangler.toml`. The flag is read in exactly one
  place — `src/gateway/routing-policy.ts`'s `turnRoutePolicy`, consulted by `src/gateway/request.ts`;
  the identity ladder in front of it is `src/gateway/agent-tier-route.ts` and the tier behind it is
  `src/gateway/agent-turn.ts`. One deliberate difference between the two positions, argued in that
  ladder's header: under `edge` an ANONYMOUS visitor may read their own transcript back
  (`ANON_V1_PATHS` still does not list that route, so the container position is unchanged) — W1's
  exit criterion is an anonymous conversation a visitor comes back to, and the retrieval's ownership
  check is what makes it safe.
- `src/agent/session/turn-catalog-session.ts` — the `CatalogToolSession` one turn hands the tools:
  the opaque refs they mint and the rows behind them. Turn-scoped ON PURPOSE, with one gap written
  on it that needs plumbing nobody has built yet: it is not rebuilt on a REPLAY (a replayed step is
  answered from `run_steps.result` without calling `execute`, so a ref minted before a crash reads
  back as `stale_ref` — #1279 owns that rehydration).
- `src/agent/session/session-envelope.ts`, `turn-envelope.ts`, `durable-envelope-store.ts` — the
  session state that DOES outlive one turn (#1280): the pending clarification and the current
  anime, as one immutable `SessionEnvelope` (per SESSION; refs stay per RUN, which is what kept
  Python's `tool_state` a bag). It is stored in the Durable Object's own `ctx.storage` under the
  `envelope` key rather than in a Neon column — the DO is the single writer (spec §三) and
  `idFromName(sessionId)` makes that storage session-scoped, `retrieval/` never reads it, and a
  column would buy a migration for a fact only the alarm touches; the full trade-off and its price
  are argued in the adapter's header. `TurnEnvelope` owns the moments: `open()` seeds the turn's
  tools and puts the stored facts into the system prompt's "Trusted runtime context" block (the
  ported half of Python's `trusted_session_context`); `stage()` writes the whole envelope under the
  run's own key BEFORE the terminal row lands, driven by the `EnvelopeStagingStore` decorator around
  the `TurnStore`; and `close(state)` promotes that staging to the session's envelope once the run
  reaches its OWN terminal path. The order is the recovery: the terminal row is in Neon and the
  envelope is in DO storage, so no transaction spans them — staging first means a failed settlement
  replays the whole turn, and a failed promotion is finished by the alarm's retry. Two rules keep a
  stale staging from outliving a newer answer: `open()` first drains every OTHER queued run's
  staging (a run whose promotion failed stays queued while its row is terminal, so a second run can
  be admitted and must start from the recovered state), and only `succeeded`, `failed` and
  `already_settled` promote. `already_settled` is its own `TurnPhase` precisely so it is not
  confused with `declined`: the first is a retry of an ending this alarm owes, the second is a live
  owner mid-turn whose staging must not be published for it.
- `src/agent/tools/` — `catalogToolbox(catalog, session)` returns the four `AgentTool`s the
  session registers on the pi agent (`resolve_anime`, `search_bangumi`, `search_nearby`,
  `plan_route`). Two ports carry everything turn-shaped: `CatalogClient` (production adapter
  `serviceBindingCatalog`, over the private `CATALOG` binding — never a URL, spec Appendix D) and
  `CatalogToolSession`, which the session's turn state implements. **The schema seam** (spec §二)
  lives at `tool-schema-bridge.ts`: contract zod is the source,
  `packages/contract/scripts/emit-tool-schemas.ts`
  is the repo's ONE zod→JSON-Schema conversion, and nothing here re-declares a constraint or loads
  zod. Adding a tool parameter means editing `packages/contract/src/agent-tool-parameters.ts` and
  re-running `pnpm --filter @animichi/contract run emit:tool-schemas`. The `respond` tool
  (`src/agent/session/turn-answer.ts`) rides the same seam, and takes `ANSWER_TOOL_NAME` +
  `CHAT_RESPONSE_INTENTS` from the generated module rather than spelling either out here.
  Two things pi does NOT do for us and this folder therefore does: the per-tool 85s deadline
  (Python got it from pydantic-ai's `Tool(timeout=…)`; `AgentTool` has no such field, so
  `catalogToolBudget` holds it, injectable so tests need no real clock), and validating a catalog
  response (the contract's zod cannot load here, so the adapter guards the one field each tool
  branches on and degrades anything else to `upstream_unavailable`).
- `src/agent/egress/` — the BYOK egress guard (W0-S5, #1248): `EgressPolicy` +
  `ProviderAllowlist` (exact provider hosts, HTTPS/443, own-infra and address-range refusals),
  `GuardedFetch` (`redirect: "manual"` and re-validation of every redirect target) and
  `SecretScrub`. Pure and binding-free, so node:test loads it directly. Nothing under `src/`
  imports it yet — `spike/pi/` is its first caller and W2's BYOK card is its home.
- `src/identity/` — auth (JWT/anonymous) + turnstile gate; `src/gateway/` — forward +
  routing/catalog policy (pure functions) + responses; `src/protect/` — rate limit / cost breaker /
  DO guard; `src/proxy/` — image/tile/showcase proxies; `src/container/` — container env +
  egress denylist data.
- `src/gateway/agent-turn.ts` — the two routes the `AGENT_TURN_ROUTE` flag can move onto this
  Worker's own agent tier (#1256), and the ONLY place that composes `intake/` + `session/` +
  `retrieval/` for a live request. Injected into the gateway seam as `GatewayDeps.agentTurns`
  so `node:test` drives the routing contract with no Neon pool and no Durable Object.
  `chat-envelope.ts` reads the AI SDK body (a port of Python's `chat_body.py`);
  `agent-turn-responses.ts` holds every non-turn answer, each labelled with the Python route it
  mirrors — the flag is a FALLBACK flag, so no shape on that wire may be new.
  Two things the switch owns beyond routing: the intake's transaction now OPENS the `sessions`
  row (Python's session store left with `apps/agent`) and refuses a conversation another identity
  owns, and it enforces `ANON_DAILY_MESSAGE_QUOTA` — the ceiling #1251 deliberately left unowned —
  by comparing the count its own reservation upsert returns, so the refusal rolls back the whole
  turn (`src/agent/intake/anonymous-message-allowance.ts`, `agent-db-test/turn-quota-ceiling.db.test.ts`).
- `test/*.test.ts` flat; test doubles live in `test/doubles/` and are imported by tests only —
  production code never imports from `test/`.
- `db-test/` — the opt-in real-PostgreSQL lane (W0-S4, #1247). Test-only, outside `pnpm test`,
  and deleted with the spike when W0 closes.
- `api-test/` — the W1-4 staging lane (#1253). Test-only and excluded from the edge deploy unit in
  `.github/ci/components.json`, like every other lane directory here.
- `agent-db-test/` — the agent-tier database arm (#1251), kept apart from `db-test/` precisely
  because that one leaves with the spike. Test-only: both directories are excluded from the edge
  deploy unit in `.github/ci/components.json`, and `pg`/`testcontainers` are devDependencies.
- `bundle-smoke/` — the pi-kernel bundler smoke gate (#1246). Test-only: its entrypoint is
  excluded from the edge deploy unit in `.github/ci/components.json`. `@earendil-works/pi-ai` and
  `pi-agent-core` are runtime `dependencies` as of #1252 — `src/agent/session/` runs the kernel,
  so a devDependency there would be a Worker that cannot bundle its own agent loop.
  Its entrypoint carries the esbuild `.lazy` chunk-init workaround reported in
  `docs/specs/2026-09-01-pi-ai-esbuild-lazy-chunk-report.md`; leave the eager
  `api/openai-completions` import alone.
- `spike/<name>/` — throwaway probe Workers with their own `wrangler.toml`, deployed by hand and
  deleted when their spike closes (`spike/pi/` = W0-S1 #1244 + W0-S2 #1245 + W0-S4 #1247 +
  W0-S5 #1248). `src/` never imports from `spike/`, and no spike is in a CD cohort; each carries
  its own README with the deploy and measurement steps.

## Runtime rules

- Edge verifies identity but does **not** re-authenticate Users: `/v1/users/*` gets
  `Authorization` stripped and verified identity forwarded as `X-User-Id`/`X-User-Type` (AUTH-2
  #950); `src/identity/auth.ts` resolves anonymous vs Neon-Auth JWT (the
  `sk_*` API-key path and the `agent` identity class are deleted, AUTH-1 #945), and
  `src/gateway/forward.ts` injects the identity headers.
- Policy stays in pure functions (`routing-policy.ts`, `catalog-policy.ts`) so it runs under
  node:test with no Cloudflare bindings; `app.ts` only wires them up. New public paths go in the
  policy tables, not the container class.
- `src/container/container-env.ts` owns the container env allowlist/required keys and the
  `DENIED_EGRESS_HOSTS` glob list — it is read verbatim by docs/security guards (see
  `docs/ops/secrets.md`, `docs/ops/cloudflare-hardening.md`); keep paths and key names in lockstep.
- The agent tier reads Neon directly through the `AGENT_SVC_DATABASE_URL` Secrets Store
  binding — the same binding the container already unwraps (`src/container/container-env.ts`,
  `docs/ops/secrets.md`), now with the Worker itself as a second consumer. Staging binds it;
  production does NOT until #855 provisions the store secret there, and binding a store secret
  that does not exist fails the deploy. It is the WebSocket driver
  (`drizzle-orm/neon-serverless`), not neon-http: the intake is an interactive multi-statement
  transaction and neon-http has no transactions.
- Durable Object classes stay plain classes with `fetch`/`alarm` (`EdgeGuard`, `RunSweeper`) —
  no `cloudflare:workers` RPC base class, so every source stays importable under node:test.
  A binding's `class_name` is resolved against `src/entry.ts`'s exports at deploy time;
  `test/agent-durable-objects.test.ts` reads the two files against each other so that failure
  cannot wait for a deploy.
- `wrangler.toml` is the single config surface (`main = "src/entry.ts"`, resolved config-relative);
  routes are declared in Pulumi, never here (#541).

## Tests

node:test (no vitest, no workers pool). The suite doubles as **workflow-content guard**:
`auth-config.test.ts`, `migration-boundary.test.ts`, `release-toolchain.test.ts`
read workflow/docs files verbatim — any change under `.github/workflows/`
or to the test-runner wiring must keep `pnpm run test:worker` green (`.claude/rules/ci.md`).
