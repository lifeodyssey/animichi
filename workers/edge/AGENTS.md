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
- `pnpm run typecheck` — `tsc --noEmit` (TypeScript 7.0.2 via workspace hoist).
- `pnpm run lint:oxlint` — type-aware oxlint, warnings denied.
- Deploy is CI-only: `wrangler deploy -c workers/edge/wrangler.toml` from the repo root
  (hook `block-local-deploy`). Never deploy locally.

## Layout (2026-08-06-edge-gateway-structure-design.md)

- `src/entry.ts` — Worker default export + `RuntimeContainer`; `src/app.ts` — Hono assembly only.
- `src/identity/` — auth (JWT/API key/anonymous) + turnstile gate; `src/gateway/` — forward +
  routing/catalog policy (pure functions) + responses; `src/protect/` — rate limit / cost breaker /
  DO guard; `src/proxy/` — image/tile/showcase proxies; `src/container/` — container env +
  egress denylist data.
- `test/*.test.ts` flat; test doubles live in `test/doubles/` and are imported by tests only —
  production code never imports from `test/`.

## Runtime rules

- Edge verifies identity but does **not** re-authenticate Users: `/v1/users/*` gets
  `Authorization` passed through untouched; `src/identity/auth.ts` resolves anonymous vs JWT vs
  API key, and `src/gateway/forward.ts` injects the identity headers.
- Policy stays in pure functions (`routing-policy.ts`, `catalog-policy.ts`) so it runs under
  node:test with no Cloudflare bindings; `app.ts` only wires them up. New public paths go in the
  policy tables, not the container class.
- `src/container/container-env.ts` owns the container env allowlist/required keys and the
  `DENIED_EGRESS_HOSTS` glob list — it is read verbatim by docs/security guards (see
  `docs/ops/secrets.md`, `docs/ops/cloudflare-hardening.md`); keep paths and key names in lockstep.
- `wrangler.toml` is the single config surface (`main = "src/entry.ts"`, resolved config-relative);
  routes are declared in Pulumi, never here (#541).

## Tests

node:test (no vitest, no workers pool). The suite doubles as **workflow-content guard**:
`auth-config.test.ts`, `migration-boundary.test.ts`, `dependabot-workflow.test.ts`,
`test-inventory.test.ts` read workflow/docs files verbatim — any change under `.github/workflows/`
or to the test-runner wiring must keep `pnpm run test:worker` green (`.claude/rules/ci.md`).
