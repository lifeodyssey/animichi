# workers/users — AGENTS.md

TypeScript Cloudflare Worker: the **user-domain data service** (saved routes today; the
anonymous-claim flow and more user data later). Owns user-scoped rows in Neon; reached ONLY via the
edge Worker's `USERS` service binding at `/v1/users/*` — no public route of its own.
Root guide: `../../AGENTS.md`. Template sibling: `../catalog/AGENTS.md`.

## Commands (from `workers/users/`)

- pnpm. `pnpm run dev` (`wrangler dev`, local) — never `wrangler deploy` (hook `block-local-deploy`).
- `pnpm test` (`test:worker`, the `vitest-pool-workers` suites, then `test:node`) ·
  `pnpm run typecheck` (TypeScript 7) · `pnpm run lint:oxlint` (type-aware, strict, warnings denied).
- `pnpm run test:node` — the plain-Node lane (`vitest.node.config.ts`): `test/sealed-bundle.node.test.ts`
  builds the sealed release bundle with `.github/scripts/release/build-worker.mjs users`, the bytes
  CD uploads, once, then starts it in workerd and asserts `/healthz` 200, profiles its startup with
  `wrangler check startup` for Prisma or ArkType schema work (`test/sealed-startup.ts`), and sends
  its first database request to a loopback listener, which proves Prisma's first load reached the
  connect. The worker pool evaluates unbundled modules, so a failure that exists only in the bundle
  shows up in this lane alone, and no CD step requests a users database route. The lane also drives
  the whole app in Node against such a listener (`test/unreachable-database.node.test.ts`), where
  the worker pool's `pg` stub could not open a socket.
- `pnpm run test:integration` — the Docker Postgres arm (`vitest.integration.config.ts`), kept out of
  `test` per #1473; pre-push, the CI affected matrix and `make check-full` all run it for this package.

## Trust model (AUTH-2 #950 — internal identity boundary, NO self-verification)

- The users service verifies NOTHING itself (the JWKS/bearer verifier was deleted). It trusts ONLY
  the edge's verified identity, which arrives over the USERS service binding as `X-User-Id`
  (+ `X-User-Type`) after the edge stripped `Authorization` and any caller-supplied identity
  headers (see `workers/api/src/gateway/forward.ts`).
- A request that still carries `Authorization` is raw bearer access (it did not come from the
  edge) → flat **401**. Missing/empty `X-User-Id` → **401**. Anonymous access is NEVER allowed
  here. Cross-user access to an owned row → defined **403** `ROUTE_NOT_OWNED`.
- There is no service-to-service secret beyond this no-public-route premise: the users worker has
  no route that is reachable outside the edge binding.
- The gateway's request ID arrives on the same binding as `X-Request-Id`, and `admit` takes it with
  the identity, through `acceptedRequestId` (`@animichi/contract/internal-binding`): only the
  gateway's lowercase-UUID format is kept, so no other header text reaches a log line. The list
  line writes it as `request_id=` (`-` when none came).

## Stack + workerd gotchas (mirrors catalog — read `../catalog/AGENTS.md` for the long form)

- Hono + oRPC; contract source of truth = `packages/contract/src/users-contract.ts`.
  The error constructors (`src/lib/errors.ts`) and the Idempotency-Key 400 (`src/index.ts`) read
  status and message from its `USERS_ERROR_DEFS`; there is no mirror to keep in lockstep, and
  `test/errors.worker.test.ts` goes red when a registry code has no producer here.
- **Prisma 8 through the `UsersPrisma` seam** (`src/db/prisma.ts`, #1632): statements are built with
  the contract-bound builder (`query.builder.public.<table>…`) and executed through one call,
  `query.executor.query(plan)`, which returns the plan's own `Row[]` — the result type comes from the
  builder, so no adapter re-derives a shape from `unknown`. Per request: the `/v1/users/*` boundary
  opens a connection (`acquireUsersRuntime`) and disposes it with `await using` on scope exit; there
  is no connection cached across requests (spec §4.2). Since Prisma rc.14 that `connect()` opens the
  socket before it returns, so it runs in an oRPC middleware (`src/request-connection.ts`) after the
  admission, the route match and input validation: an unknown path and invalid input are answered
  without a connection, and an unreachable database answers oRPC's 500 with its JSON error body
  (`test/unreachable-database.node.test.ts`).
- **Prisma loads on the first request that needs it, not at startup** (`src/db/prisma-first-use.ts`):
  Cloudflare refuses a Worker whose global scope takes longer than a second to evaluate, and the
  Prisma modules `src/db/prisma.ts` imports, building ArkType's schemas, were more than half of this
  Worker's startup. Production code reaches `src/db/prisma.ts` only through that module or with
  `import type`; a static value import brings the work back. One load serves an isolate, a load that
  fails stays failed, and the boundary answers it as it answers a failed acquire
  (`test/prisma-first-use.worker.test.ts`).
- **Arrays**: the builder binds `text[]` as one parameter — the old `sql.param(arr)::text[]` rule is
  gone with the Drizzle lane.
- **timestamptz** arrives as the codec's ISO 8601 UTC string with every fractional digit the server
  sent, on workerd and Node alike (Prisma rc.21) → the boundary still maps it through
  `new Date(v).toISOString()` (`src/db/timestamptz.ts`), the millisecond form the public model
  carries and `apps/web` sorts as text (`title` null → `""` is the other half of the same
  public-model mapping).
- **Identifiers belong to the database**: `saved_routes.id` is `uuidv7()`; no INSERT supplies one.
  The idempotent create's route INSERT and ledger commit ride ONE transaction, the connection's own
  `transaction(fn)`, which is what lets the second statement read the first's `RETURNING` (the old
  neon-http batch could not, and minted the id in the worker instead).
- **The ledger's reclaim predicate rides an UPDATE's own `WHERE`.** Prisma 8 has no
  `ON CONFLICT … DO UPDATE … WHERE` (spec U2), so `claim` is an INSERT whose composite-key conflict
  is read as "already claimed", and `reclaim` is an UPDATE. The predicate must be evaluated against
  the row AS IT STANDS — that is what #1222 was about; the real-database proof is in
  `test/idempotency-ledger.integration.test.ts`.
- zod value imports only at the contract/handler boundary; internals `import type` from
  `@animichi/contract`. Two exceptions: `SavedRoute` in `src/adapters/neon-idempotency-store.ts`,
  which validates the ledger's `jsonb` snapshot — a column whose shape no query builder can type —
  and `USERS_ERROR_DEFS` in `src/lib/errors.ts`, read for status and message only. `usersContract`
  picks its error map from that registry (`pickUsersErrors`), and `router.ts` already ships
  `usersContract`, so reading the registry adds nothing to the bundle.

## Config / secrets

- `wrangler.toml` `[vars]` holds ENVIRONMENT only. `DATABASE_URL` is a secret: `.dev.vars`
  locally (see `.dev.vars.example`); in staging and production a Cloudflare Secrets Store binding
  (`USERS_DATABASE_URL` / `USERS_DATABASE_URL_PROD`, provisioned by the `infra/database-access`
  Pulumi stack), so CI uploads no DSN. `src/index.ts` awaits the binding's `.get()`. The users
  worker no longer reads `NEON_AUTH_JWKS_URL` (identity arrives as headers).
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
