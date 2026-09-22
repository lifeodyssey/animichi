# workers/users — AGENTS.md

TypeScript Cloudflare Worker: the **user-domain data service** (saved routes today; the
anonymous-claim flow and more user data later). Owns user-scoped rows in Neon; reached ONLY via the
edge Worker's `USERS` service binding at `/v1/users/*` — no public route of its own.
Root guide: `../../AGENTS.md`. Template sibling: `../catalog/AGENTS.md`.

## Commands (from `workers/users/`)

- pnpm. `pnpm run dev` (`wrangler dev`, local) — never `wrangler deploy` (hook `block-local-deploy`).
- `pnpm test` / `pnpm run test:worker` (`vitest-pool-workers`) · `pnpm run typecheck`
  (TypeScript 7.0.2) · `pnpm run lint:oxlint` (type-aware, strict, warnings denied).
- `pnpm run test:integration` — the Docker Postgres arm (`vitest.integration.config.ts`), kept out of
  `test` per #1473; pre-push, the CI affected matrix and `make check-full` all run it for this package.

## Trust model (AUTH-2 #950 — internal identity boundary, NO self-verification)

- The users service verifies NOTHING itself (the JWKS/bearer verifier was deleted). It trusts ONLY
  the edge's verified identity, which arrives over the USERS service binding as `X-User-Id`
  (+ `X-User-Type`) after the edge stripped `Authorization` and any caller-supplied identity
  headers (see `workers/edge/src/gateway/forward.ts`).
- A request that still carries `Authorization` is raw bearer access (it did not come from the
  edge) → flat **401**. Missing/empty `X-User-Id` → **401**. Anonymous access is NEVER allowed
  here. Cross-user access to an owned row → defined **403** `ROUTE_NOT_OWNED`.
- There is no service-to-service secret beyond this no-public-route premise: the users worker has
  no route that is reachable outside the edge binding.

## Stack + workerd gotchas (mirrors catalog — read `../catalog/AGENTS.md` for the long form)

- Hono + oRPC; contract source of truth = `packages/contract/src/users-contract.ts`
  (error registry mirror: `src/lib/errors.ts` — keep in lockstep).
- **Prisma 8 through the `UsersPrisma` seam** (`src/db/prisma.ts`, #1632): statements are built with
  the contract-bound builder (`query.builder.public.<table>…`) and executed through one call,
  `query.executor.query(plan)`, which returns the plan's own `Row[]` — the result type comes from the
  builder, so no adapter re-derives a shape from `unknown`. Per request: the `/v1/users/*` boundary
  acquires a runtime (`acquireUsersRuntime`) and disposes it with `await using` on scope exit; there
  is no connection cached across requests (spec §4.2).
- **Arrays**: the builder binds `text[]` as one parameter — the old `sql.param(arr)::text[]` rule is
  gone with the Drizzle lane.
- **timestamptz** arrives as a `Date` under Node and text under workerd → normalize
  `new Date(v).toISOString()` at the boundary (`title` null → `""` is the other half of the same
  public-model mapping).
- **Identifiers belong to the database**: `saved_routes.id` is `uuidv7()`; no INSERT supplies one.
  The idempotent create's route INSERT and ledger commit ride ONE `withTransaction`, which is what
  lets the second statement read the first's `RETURNING` (the old neon-http batch could not, and
  minted the id in the worker instead).
- **The ledger's reclaim predicate rides an UPDATE's own `WHERE`.** Prisma 8 has no
  `ON CONFLICT … DO UPDATE … WHERE` (spec U2), so `claim` is an INSERT whose composite-key conflict
  is read as "already claimed", and `reclaim` is an UPDATE. The predicate must be evaluated against
  the row AS IT STANDS — that is what #1222 was about; the real-database proof is in
  `test/idempotency-ledger.integration.test.ts`.
- zod value imports only at the contract/handler boundary; internals `import type` from
  `@animichi/contract`. The one exception is `SavedRoute` in `src/adapters/neon-idempotency-store.ts`,
  which validates the ledger's `jsonb` snapshot — a column whose shape no query builder can type.

## Config / secrets

- `wrangler.toml` `[vars]` holds ENVIRONMENT only. `DATABASE_URL` is a secret
  (`.dev.vars` locally — see `.dev.vars.example`; `wrangler secret put` / deploy-lane env
  in CI). The users worker no longer reads `NEON_AUTH_JWKS_URL` (identity arrives as headers).
- Envs: `[env.staging]` = `users-staging`, `[env.production]` = `users` (routeless; binding-only).
- DB schema changes ride the one Prisma chain in `packages/pi-session-neon/` (`make db-new`).

## Tests

TDD via `vitest-pool-workers` (`test/*.worker.test.ts`, ≤200 lines each). Identity is injected as
the edge-forwarded `X-User-Id` header (`identity-fixture.ts`); `fake-users-prisma.ts` is the fake
executor — the REAL builder paired with an in-memory data plane that reads the plan's AST, evaluates
its `WHERE` and projects its `returning(...)`. It throws on a shape it cannot model rather than
skipping a predicate, because a skipped predicate would make every scoping assertion pass for free.

Real-database round-trips (array and timestamptz serialization, the CHECK constraints, `uuidv7()`,
and the reclaim semantics) live in `test/*.integration.test.ts` under `test:integration`.
