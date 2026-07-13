# workers/users — AGENTS.md

TypeScript Cloudflare Worker: the **user-domain data service** (saved routes today; the
anonymous-claim flow and more user data later). Owns user-scoped rows in Neon; reached ONLY via the
root Worker's `USERS` service binding at `/v1/users/*` — no public route of its own.
Root guide: `../../AGENTS.md`. Template sibling: `../catalog/AGENTS.md`.

## Commands (from `workers/users/`)

- pnpm. `pnpm run dev` (`wrangler dev`, local) — never `wrangler deploy` (hook `block-local-deploy`).
- `pnpm test` / `pnpm run test:worker` (`vitest-pool-workers`) · `pnpm run typecheck` (`tsc --noEmit`).

## Trust model (S2.8 — DIFFERENT from the container `/v1/*` path)

- Every `/v1/users/*` request must carry a **Neon Auth JWT** as `Authorization: Bearer`. This
  service verifies it ITSELF with jose: `createRemoteJWKSet` against `env.NEON_AUTH_JWKS_URL`
  (cached per URL — never refetched per request), EdDSA only, `iss` == `aud` == the JWKS URL minus
  `/.well-known/jwks.json`. `sub` becomes the row-scoping `user_id`.
- No valid JWT → flat **401**. Anonymous access is NEVER allowed here (do not conflate with Chat's
  anonymous `/v1/*` model). Cross-user access to an owned row → defined **403** `ROUTE_NOT_OWNED`
  (rejected here, not silently at the DB layer).
- The edge Worker passes `Authorization` through untouched; it does not pre-authenticate this path.

## Stack + workerd gotchas (mirrors catalog — read `../catalog/AGENTS.md` for the long form)

- Hono + oRPC; contract source of truth = `packages/contract/src/users-contract.ts`
  (error registry mirror: `src/lib/errors.ts` — keep in lockstep).
- **Drizzle is typing only** (`src/db/schema.ts`); every query goes through the raw `sql` tagged
  template via the minimal `DbExecutor` (`execute` only). The fluent builder hangs under
  workerd + neon-http.
- **Arrays**: interpolating a JS array in the `sql` template expands to a tuple (`($1,$2)`; empty
  → invalid `()`). Bind arrays as ONE param: `${sql.param(arr)}::text[]` (see `src/api/routes.ts`).
- **timestamptz** returns raw strings under workerd → normalize `new Date(v).toISOString()` at the
  boundary.
- zod value imports only at the contract/handler boundary; internals `import type` from
  `@seichijunrei/contract`.

## Config / secrets

- `wrangler.toml` `[vars]` holds ENVIRONMENT only. `DATABASE_URL` + `NEON_AUTH_JWKS_URL` are
  secrets (`.dev.vars` locally — see `.dev.vars.example`; `wrangler secret put` / deploy-lane env
  in CI). Never commit real Neon URLs or project ids.
- Envs: `[env.staging]` = `users-staging`, `[env.production]` = `users` (routeless; binding-only).
- DB schema changes ride `db/migrations/` (atlas, timestamped files + `atlas migrate hash`).

## Tests

TDD via `vitest-pool-workers` (`test/*.worker.test.ts`, ≤200 lines each). JWTs are minted in-test
(Ed25519 + `createLocalJWKSet`) and injected through `createUsersApp({ getKey, makeDb })`; the fake
executor renders queries with `PgDialect.sqlToQuery` — no drizzle-internals guessing. Real-DB
round-trips (neon-http array/timestamptz serialization) are NOT covered here yet — verify against a
real Postgres before building on top (leftover from S2.8).
