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
- `pnpm run test:spike-db` — opt-in lane (`db-test/*.test.ts`) that runs the W0-S4 spike's run
  store against a **real** PostgreSQL named by `SPIKE_TEST_DATABASE_URL`. Never in CI and never
  against staging; it fails closed without a disposable database. Recipe: `spike/pi/README.md`.
- `pnpm run test:agent-db` — the W1-2 agent-tier database arm (#1251): boots a disposable
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
  `runs`, `run_steps`); query-only metadata, never a DDL authority (`migrations/neon` owns
  the schema).
- `src/agent/` — the agent turn tier (W1, spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md`):
  `intake/` (one `POST /v1/chat` becomes one transaction: message + `running` run + quota
  reservation, then `setAlarm(now)` on the session), `session/` (the wake-up port and the
  request `AgentSession` answers — the class itself is #1252), `sweeper/` (the singleton
  `RunSweeper` DO, the at-least-once backstop), `settlement/` (how a turn ENDS: the run's
  terminal row, its `daily_usage` rollup and its quota refund, as two functions #1252 calls
  on its own transaction alongside the assistant message). Ports live with the use case, Neon adapters
  beside them, and no module here imports `cloudflare:workers` so the node:test suite can load
  every one of them. Nothing routes to it yet — #1256 flips `/v1/chat`.
- `src/agent/egress/` — the BYOK egress guard (W0-S5, #1248): `EgressPolicy` +
  `ProviderAllowlist` (exact provider hosts, HTTPS/443, own-infra and address-range refusals),
  `GuardedFetch` (`redirect: "manual"` and re-validation of every redirect target) and
  `SecretScrub`. Pure and binding-free, so node:test loads it directly. Nothing under `src/`
  imports it yet — `spike/pi/` is its first caller and W2's BYOK card is its home.
- `src/identity/` — auth (JWT/anonymous) + turnstile gate; `src/gateway/` — forward +
  routing/catalog policy (pure functions) + responses; `src/protect/` — rate limit / cost breaker /
  DO guard; `src/proxy/` — image/tile/showcase proxies; `src/container/` — container env +
  egress denylist data.
- `test/*.test.ts` flat; test doubles live in `test/doubles/` and are imported by tests only —
  production code never imports from `test/`.
- `db-test/` — the opt-in real-PostgreSQL lane (W0-S4, #1247). Test-only, outside `pnpm test`,
  and deleted with the spike when W0 closes.
- `agent-db-test/` — the agent-tier database arm (#1251), kept apart from `db-test/` precisely
  because that one leaves with the spike. Test-only: both directories are excluded from the edge
  deploy unit in `.github/ci/components.json`, and `pg`/`testcontainers` are devDependencies.
- `bundle-smoke/` — the pi-kernel bundler smoke gate (#1246). Test-only: excluded from the edge
  deploy unit in `.github/ci/components.json`, and `@earendil-works/pi-ai` is a devDependency.
  Its entrypoint carries the esbuild `.lazy` chunk-init workaround reported in
  `docs/specs/2026-09-01-pi-ai-esbuild-lazy-chunk-report.md`; leave the eager
  `api/openai-completions` import alone.
- `spike/<name>/` — throwaway probe Workers with their own `wrangler.toml`, deployed by hand and
  deleted when their spike closes (`spike/pi/` = W0-S1, #1244). `src/` never imports from `spike/`,
  and no spike is in a CD cohort; each carries its own README with the deploy and measurement steps.

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
