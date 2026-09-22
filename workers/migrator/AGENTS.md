# workers/migrator — AGENTS.md

TypeScript Cloudflare Worker: the **migration executor** (spec
`docs/specs/2026-08-16-migration-executor-spec.md`, issue #1051; Option 2
connectivity spec / #1124). A request authenticated by a GitHub Actions OIDC
token applies the sealed Prisma graph through the official control client, and
returns that one authority's applied marker (#1634). Both environments go through it since #1365
(#1055 closed): `[env.staging]` and `[env.production]` are separate Workers with
separate DSN secrets and separate OIDC allowlists. Root guide:
`../../AGENTS.md`.

## Commands (from `workers/migrator/`)

- pnpm. `pnpm run typecheck` (TypeScript 7.0.2) · `pnpm run lint:oxlint`
  (type-aware, strict, warnings denied) · `pnpm run test` / `pnpm run test:worker`
  (vitest + coverage). Never `wrangler deploy` locally (hook `block-local-deploy`).
- `pnpm run test:integration` runs authenticated HTTP and the actual bundled
  workerd entry against disposable PostgreSQL (including the fixed Durable Object),
  using `@animichi/test-postgres` and Docker. No Atlas binary is involved.

## What this worker does

1. **Verify identity**: reads `Authorization: Bearer <github-oidc-token>`,
   verifies it with jose (RS256) against GitHub's JWKS (constructor-injected
   for tests), then enforces the per-environment-anchored claims allowlist
   (MED-2): staging = `ref == refs/heads/main` AND `environment == staging`;
   production = the same pair with `environment == production`, or the
   fully-qualified `sub == repo:lifeodyssey/animichi:environment:production`.
   The two are SEPARATE constants picked by the `MIGRATOR_OIDC_POLICY` var
   (default staging), never one merged array — `refAnchored` is
   `refAllow.some(...)`, so a merged array would let the staging job's token
   open the production door. Both also require
   repository == `lifeodyssey/animichi`, and
   `workflow_ref/job_workflow_ref` in the trusted deploy workflows. The
   audience is the fixed `animichi:github-actions:migrator` — specific to this
   door, so a GitHub OIDC token minted for anything else is rejected rather
   than cross-accepted. The reusable verifier lives in
   `packages/contract/src/oidc-github.ts` (`@animichi/contract/oidc-github`).
2. **Apply the sealed graph (#1124, #1634)**: after OIDC, a fixed-name
   Durable Object mutex (`migrator-apply-lock`, not `migrator-job-*`)
   serializes apply. The gate is the object's own `QueueLock`, **not**
   `blockConcurrencyWhile` (#1868): the platform caps that callback at 30
   seconds and resets the object on overrun, which is how a staging apply died
   at 31 s on 2026-09-22. An RPC that stays in flight keeps the object alive
   with no such bound, so the apply is only as long as the migration is. Inside that gate the Worker rechecks the requested schema
   identity against the graph it carries and then calls Prisma's control client,
   which owns graph traversal, per-migration transactions, its advisory lock and
   the marker. The migrator no longer carries an apply loop, a revision ledger,
   a checksum parser, a statement splitter or a SQL client of its own; one
   authority owns the database. A `-pooler` DSN is still rejected before any
   connection (`src/direct-dsn.ts`), because Neon schema DDL needs the direct
   host. SQL is never taken from the request body (OIDC + a required
   `{expectedPrismaRef}` key set only, compared exactly).
   The retired batch container has no binding, class, image or runtime path (#1589).
   `test/atlas-engine-retired.test.ts` fails if any deleted module, or an import
   of one, reappears.
3. **Answer for the identity it carries (#1365, closes #1332, #1634)**: `wrangler
   deploy` returning is not the new bundle serving, and the old bundle answering a
   POST would apply a graph the release never packaged. `GET /healthz` therefore
   reports `prismaTarget` — the contract hash compiled into THIS deployment — and
   `/preflight` and `/migrate` answer `409 {error:"stale_prisma_bundle",
   prismaTarget}` to an identity the carried graph does not hold, before they
   resolve a DSN. `scripts/delivery/migrate-through-worker.sh` polls the first and
   retries the second, bounded (over https only — curl refuses any lesser
   transport, redirects included, for calls that carry the OIDC token). There is
   one identity on both sides; a request the graph cannot reach is refused, never
   partially applied.
4. **Report**: a failure that THREW names which of the two things threw and
   carries its cause (#1868). `apply_dispatch_failed` means no apply produced a
   verdict — the secret did not resolve, the lock is unbound, or the Durable
   Object RPC itself failed — so the database state is unread; `migration_unavailable`
   is the narrower fact that the apply ran and threw. Both put the thrown message
   through `src/redacted-cause.ts` first, and log it as well as return it,
   because the answer itself can be lost on the way out. Every handled outcome
   keeps its own identity and no cause: `refused`, a native failure code,
   `prisma_marker_mismatch`, `stale_prisma_bundle`.
   Otherwise: returns success plus Prisma's own receipt — `markerHash`,
   `migrationsApplied` and `applied`. A receipt whose marker is not the requested
   identity refuses success (`prisma_marker_mismatch`). That receipt is visible
   **only** through this OIDC-authenticated response: #1339 removed the anonymous
   `GET /ledger-head` route (it resolved the DDL-capable DSN on every anonymous hit
   of a public `workers_dev` host and had no caller), and
   `test/migrate.worker.http.test.ts` pins the 404. The post-staging smoke (#1198,
   `.github/scripts/staging-smoke-check.sh`) probes the edge and the web shell, not
   the marker; if it is ever extended to assert it, it must read a short-TTL value
   written at apply time (KV / DO storage), never a live DSN read.
5. **Answer for the promoted catalog schema (#1230 Phase 1)**: `GET
   /catalog-schema` reads `bangumi`, `points` and `ingest_jobs` out of the
   target in one read-only repeatable-read transaction and answers `200` or
   `422 {status:"incomplete", tables, missing}`, naming what is absent
   (`src/catalog-tables.ts` holds the compile-time list; no identifier comes
   off the request). CD runs `scripts/delivery/verify-catalog-schema.sh
   <environment>` after the selected chain applies, because "the chain
   applied" and "the catalog exists" are different claims — staging held all
   three tables while production held none, and a promotion that delivered
   neither would have reported success.

Capability boundary: NO destructive path — no schema drop, no arbitrary SQL,
no down-migration. The migrator DSN is Secrets Store only (non-resident);
`workers/edge/test/migrator-role-isolation.test.ts` asserts it is not bound
by any runtime worker.

## Read-only compatibility preflight (#1575, #1634)

`POST /preflight` accepts exactly `{expectedPrismaRef}`; the key set is
compared by exact match, so an extra or missing key is an invalid request rather than an ignored
field — which is why sender and receiver can only change together. The whole JSON body is bounded
to 65,536 bytes. Metadata contains no SQL, URL, DSN or environment override. The existing jose
policy verifies identity before any secret or preview; this endpoint also requires
`ref == refs/heads/main` independently of a valid production subject.

The preview is Prisma's public `executeMigrateShowPlan`, which reads the live marker without
initializing its schema, and returns `prisma: {targetHash, markerHash, migrations, usedLiveMarker}`.
An identity the bundle does not carry returns retryable `409 stale_prisma_bundle`; an unusable
live path returns `422` with a stable code and never a driver detail. Nothing here creates a
schema, applies a migration or takes the apply lock. A database still carrying the retired Atlas
chain's revisions ledger is refused on both routes as
`atlas_leftovers_present` before Prisma reads it (`src/atlas-leftovers.ts`, #1625): the baseline
would otherwise fail with 42710 inside the apply. CD's staging job rebuilds that state first.
There is no artifact-level production gate in this request: the owner deleted it rather than
rehousing it (#1621), and what protects production is the `production` GitHub environment's own
approval.

`/migrate` requires the same metadata, rechecks the identity INSIDE the fixed lock — a prior
preview is no authority — and then hands the exact snapshot and `refHash` to
`ControlClient.migrate`. `test/selected-request.workerd.test.ts` exercises real Hono/jose and the
native DO through Miniflare for the boundaries decided before any database contact;
`test/integration/prisma.integration.ts` and `prisma.workerd.integration.ts` execute the apply,
the replay, the rollback and the concurrent apply on disposable PostgreSQL.
Activation still requires authorized staging and production preflight bootstrap.
Local tests prove neither deployment nor production approval; see the canonical
[deployment runbook](../../docs/ops/deployment.md#read-only-migration-preflight-1575).

## Sealed native migrations (#1539)

`GET /healthz` also returns `prismaTarget`, the packaged contract's
`storage.storageHash`. The release publishes its migrator bundle before native
preflight: an older executor cannot inspect a graph it does not carry.
`node workers/migrator/scripts/prepare-migrations.ts <bundle-directory>` copies
the public package's complete `migrations/` and `contract.json` byte for byte.
The sealed no-bundle Wrangler config loads `contract.json`, `migrations/**/*.json`
and `migrations/**/*.d.ts` as Text modules with preserved file names. Native
filesystem APIs then read the graph at `/bundle/migrations`.

Native requests select only a 64-character hash in a packaged snapshot. They
cannot supply SQL, a graph, a path or a DSN.

Prisma alone owns every object in the data plane and the `prisma_contract`
marker schema. The direct migrator role needs database `CREATE` to initialize
that schema plus its existing table/schema privileges. The disposable PostgreSQL suite proves this with a NOSUPERUSER
role: missing CREATE fails apply, the inherited grant succeeds, and replay
applies zero migrations. CI receives no DSN; the Worker resolves its secret.

## Tests

TDD at the HTTP seam (`test/migrate.worker.auth.test.ts` +
`test/migrate.worker.http.test.ts` + `test/apply-lock.test.ts` +
`test/migrate.worker.thrown.test.ts` + `test/direct-dsn.test.ts`): valid test-signed JWT → apply + success; wrong repo /
wrong audience / expired → 403; `-pooler` rejected before any connection;
fixed-name lock and in-process queueing; a `/migrate` that threw names which
site threw and carries a redacted cause. `test/apply-lock.workerd.test.ts` owns
the Durable Object's own behaviour — the class bundled from `src/` unchanged,
its collaborator swapped at link time for `test/recorded-apply.ts` — and proves
serialization by order and that an apply of 32 s returns rather than resetting
the object. It replaced an assertion that read `src/apply-lock.ts` and matched
it for the string "blockConcurrencyWhile": that pinned the construct which
caused #1868, and any fix keeping the word would have left it green. The
executor and JWKS are injected in plain Vitest, and `test/selected-executor-double.ts` records every DSN the route
hands it — so a refusal test asserts the route never reached the database, not
merely that it answered a refusal. `test/deployment-contract.test.ts` resolves
all three Wrangler rings and bundles the deployed entry with an esbuild
metafile, pinning the deleted class and the absence of the retired binding,
container configuration and SDK import. Release contracts prove the migrator
bundle has no image and CD retires the old application before deploying the
Durable Object class deletion.

Three files own the #1365 surfaces. `test/policy.test.ts` judges CLAIMS against
both allowlists (the cross-replay matrix, plus the control case: an
`environment:production` sub with no `environment` claim is admitted by
`subAnchored` BY DESIGN) and asserts the two never carry each other's shape.
`test/migrate.worker.policy-selection.test.ts` proves the deployed Worker
actually picks one — without it `policyFor` could be dead code and every claims
test would still pass. `test/migrate.worker.handshake.test.ts` owns `/healthz`'s
`prismaTarget` and the 409, including that it precedes the DSN.

Test timeouts are budgets, not defaults (#1594). `test/test-timeout-budget.ts`
declares one number per suite kind with the measurement that justifies it: the
unit arm keeps vitest's tight 5 s for plain in-process tests, the workerd
suites carry their own `describe(…, { timeout })` — including the 90 s one
`apply-lock.workerd.test.ts` needs to spend longer than the platform's own
30-second cap, which workerd exposes no knob to shorten — and the integration config
is package-wide because every file there provisions a database of its own on
the shared container (#1663) and migrates it. `test/vitest-config-timeout.test.ts`
globs every `vitest*.config.{ts,mts,cts,js,mjs,cjs}` in the package — every
extension Vite loads a config from, because a review probe renaming one to
`.mts` slipped past a `.ts`-only glob with the suite still green — and fails a
config that declares no budget or an undeclared number, so a new arm cannot
inherit the 5 s default; `pinsSuiteBudget` does the same for a suite whose
scoped budget is removed. No retries, no flaky marker.
