# packages/test-postgres — AGENTS.md

The one disposable PostgreSQL + PostGIS + pgvector data plane every database-backed suite boots
(#1326). Plain **Node** package, and **test-only**: it depends on `testcontainers` and `pg`, neither
of which runs on workerd, so it is a devDependency of its consumers and never a dependency.
Root guide: `../../AGENTS.md`.

Before it existed the same recipe — the image tag, the clean database from `template1`, the chain
apply — was written three times, in three languages, and #1324 fixed the startup race in only one of
them. What each arm keeps is its own database name and its own budget; everything else is here.

The chain is the committed Prisma one (#1626), which lives with the contract that owns it
(`packages/pi-session-neon/prisma.config.ts`), and the five service roles are created here because a
disposable container has no Pulumi to create them (#1625).

## Commands (from `packages/test-postgres/`)

- `pnpm run test` — `node --test` over `test/*.test.ts` (Node's native TS type stripping; no bundler,
  no Docker, no clock).
- `pnpm run test:integration` — `node --test` over `test/integration/*.test.ts`: the shared
  container's own contracts. This one needs Docker and the local image.
- `pnpm run typecheck` — TypeScript 7.0.2 `tsc --noEmit`.
- `pnpm run lint:oxlint` — type-aware oxlint, warnings denied.
- Pre-push runs all four when a changed file lands in this package
  (`scripts/local-gates/pre-push-affected.sh`), which is also how CI's affected matrix runs them.

`test` stays Docker-free on purpose (the #1473 rule): the container contracts live in
`test:integration`, alongside the arms that boot it in their own gates —
`pnpm --filter catalog run test:integration` and `pnpm --filter edge-worker run test:agent-db`.

## The API

| Export | Is |
|---|---|
| `startTestPostgresCluster({ budget })` | the cluster alone: reuse or boot → wait → five service roles → `{ adminDsn }`. No database, no chain, nothing to stop — for an arm that creates every database it reads (#1783) |
| `startTestPostgres({ database, budget })` | the whole recipe: that cluster → clone from the migrated template (#1769) → `{ dsn, stop }`, for an arm that reads the data plane's schema |
| `createMigratedDatabase(adminDsn, name)` | clone `name` from the container's one Prisma-migrated template; the seed applies the chain once per identity and holds the cluster turn, the clone does not |
| `SetupBudget` · `SPIKE_SETUP_BUDGET` · `AGENT_DB_SETUP_BUDGET` · `hookTimeoutMs` | the wall-clock allowance one arm may spend, one instance per arm |
| `SetupDeadline` | what is LEFT of that allowance, and what a phase may spend of it (#1318) |
| `OFFLINE_POSTGRES_IMAGE` | the image tag, read from `postgres-image.env` |
| `PostgresStartupWait` · `StartupWaitLimits` · `isStartingUp` · `Pause` | the bounded first-session probe (#1324) |
| `createCleanDatabase` · `dropCleanDatabase` | the clean database and the drop, for an arm that needs a database of its own |
| `applyPrismaChain` · `ChainApplyTurn` | the chain apply and the cluster turn it runs in, for the arms that create databases themselves |
| `createServiceRoles` · `assertServiceRoles` · `SERVICE_ROLES` | the role matrix, created for a disposable cluster and asserted by name |
| `uniqueDatabaseName` | the per-call database name, for an arm that creates databases of its own |
| `clusterAdminDsn` · `POSTGRES_USER` · `POSTGRES_PASSWORD` | the admin connection and credentials, for an arm that holds the cluster turn or builds a second DSN |

`src/setup-budget.ts`, `src/setup-deadline.ts`, `src/postgres-image.ts` and
`src/postgres-startup-wait.ts` are also reachable as subpath exports, so a consumer that only wants
a number does not load `testcontainers` to get it.

## One shared container, one database per call (#1663)

`.withReuse()` keys the container on the image and the create options, so every arm in every
worktree on this host shares ONE server for the pinned image: the emulated initdb (~62 s on arm64)
is paid once instead of once per arm, and a killed run leaves a container the next run picks up
rather than an orphan.

The isolation unit is therefore the **database**, not the container. Every `startTestPostgres` call
creates a uniquely named database — `uniqueDatabaseName(suite)`: the suite name plus 12 hex
characters, inside PostgreSQL's 63-byte identifier ceiling — by cloning the container's one
migrated template (#1769). The `stop()` it hands back drops THAT database with
`DROP DATABASE ... WITH (FORCE)` and leaves the server running; a failure after the database exists
drops it too. A consumer that creates databases of its own (`workers/migrator`, `pi-session-neon`)
names them with `uniqueDatabaseName` and drops them with `dropCleanDatabase`. Arms that need the
data-plane schema without going through `startTestPostgres` call `createMigratedDatabase`.

Reuse is on unless `TESTCONTAINERS_REUSE_ENABLE=false`. Testcontainers' creation lock is in-process
only (`async-lock`), so two processes booting at the same moment may each create a container: the
loser's is left for a later run to meet. Pre-push runs packages serially, so no duplicate is
measured on this host — add a cross-process lock only if one appears.

**Removing the shared container.** A new image tag, or a testcontainers upgrade, changes the hash
in the container's `org.testcontainers.container-hash` label: the old container is left behind.

```bash
docker ps -a --filter label=org.testcontainers.container-hash --format '{{.ID}}\t{{.Image}}\t{{.Status}}'
docker rm -f $(docker ps -aq --filter label=org.testcontainers.container-hash)
```

## One deadline, two ceilings (`src/setup-budget.ts`, `src/setup-deadline.ts`)

The phases that can hang — the port bind and the two connection waits — share **one wall-clock
deadline**, they do not each get a timeout. Three independent timeouts was the bug #1318 found:
240 s for the bind plus 60 s per wait is 360 s inside a 300 s hook, so a slow boot killed the lane
instead of failing the phase that overran. `SetupDeadline` is what enforces that — the bind is
offered `remainingMs()`, and each wait converts what survives into attempts.

`SetupBudget` is the allowance; the two arms differ in exactly one number, and deliberately:

| | catalog spike | edge agent-db |
|---|---|---|
| containers | one shared per host | one shared per host |
| `deadlineMs` | 240 s | 240 s |
| `firstSession` | 30 × 1 s | 60 × 1 s (may queue behind another boot) |
| `chainMarginMs` | 60 s | 60 s |
| `hookTimeoutMs(budget)` | 300 s (unused — see below) | 300 s = `SETUP_HOOK_TIMEOUT_MS` |

240 s because the published image is `linux/amd64`: on an arm64 host initdb runs emulated (~62 s
measured) and crosses testcontainers' own 60 s default on a container that is fine.

**The catalog arm has no runner-imposed hook deadline at all.** vitest's `hookTimeout` governs
in-file `beforeAll`/`afterAll`, not `globalSetup`: `_initializeGlobalSetup()` in vitest 4.1.11
simply `await`s the setup with no timeout wrapper (checked in `node_modules/vitest`, not assumed).
So `vitest.integration.config.ts`'s `hookTimeout` is unrelated to the data plane, and `deadlineMs` is
the catalog arm's only bound. Do not wire one to the other.

`test/setup-budget.test.ts` pins every number and checks the edge arm still derives
`SETUP_DEADLINE_MS` / `SETUP_HOOK_TIMEOUT_MS` from the budget; `test/setup-deadline.test.ts` is
#1318's own arithmetic, on a fake clock.

## The image tag has one declaration (`postgres-image.env`)

Three consumers resolve it and they do not share a language, so the tag lives in a file both can
read: `src/postgres-image.ts` parses it, `scripts/local-gates/db-fresh-schema.sh` sources it as
bash. `test/image-tag-contract.test.ts` resolves it **both ways** — it runs the shell read rather
than reading the shell — and then checks that no consumer kept a tag of its own to drift with.

Building the image is the one step that needs network, and it is the fourth consumer
(`.github/workflows/pr-verification.yml`). Every `run:` that builds it sources the declaration like
any other shell and names no tag — the `affected`, `e2e` and `db` jobs each have one such step, and
`.github/test/pr-verification-affected.test.rb` derives that set from the workflow itself rather than
reading this guide:

```bash
. packages/test-postgres/postgres-image.env
docker build -f packages/test-postgres/Dockerfile -t "$TEST_POSTGRES_IMAGE" .
```

`test/image-tag-contract.test.ts` does **not** read the workflow (card B2 / #1360): pipeline text
belongs to `.github/test/pr-verification-affected.test.rb`, which reads `postgres-image.env` itself
and fails any build step that does not source it first and tag from `$TEST_POSTGRES_IMAGE`.

## Pitfalls

- **Node's type stripping, not a bundler.** `workers/edge`'s lane loads this package through
  `node --test`, which strips types rather than compiling them: no constructor parameter properties,
  no enums, no namespaces, and intra-package imports carry the `.ts` extension.
- **The startup wait never swallows a failure that is not a startup symptom.** It retries `57P03`,
  `ECONNREFUSED` and `ECONNRESET`; anything else — a wrong password, a missing database — rethrows on
  the first attempt. The pre-#1326 edge fixture retried everything for 60 s and then reported a
  generic timeout; that is the behaviour that changed, on purpose.
- **No chain is applied to the image's own database.** The image pre-initialises it with its own
  extension set — postgis, vector, documentdb and the objects those bring — so it is never the
  pristine schema the chain's clean-apply check needs: an apply there would pass or fail for
  reasons that say nothing about a fresh schema. `createCleanDatabase` still creates from pristine
  `template1`; `startTestPostgres` clones the migrated template instead.
- **`startTestPostgres` drops its own database on any failure after `.start()`**, and `stop()`
  drops it too: the shared container is never stopped by an arm (#1663). Do not add a code path that
  returns a plane without that guarantee.
- **Never bundled.** `test/never-bundled.test.ts` scans both consumers' `src/` trees for all four
  module-load shapes. A `bundle-smoke`-style gate would prove nothing — the package is never in a
  bundle to smoke.
- **Role creation and template seeding are serialized, not parallel.** `CREATE ROLE` is cluster-global
  and not atomic (`IF NOT EXISTS` then `CREATE ROLE`), and the chain's grant matrix prechecks the
  same rows, so role creation and the one-time template seed run inside a session-level
  `pg_advisory_lock` on the admin connection (#1663): two callers that reach the role block together
  — two calls in one process, two arms, two worktrees — would otherwise both read an empty
  `pg_roles` and the second would die on `pg_authid_rolname_index`, which is how CI's edge lane
  failed. Cloning a database from the template does not take that lock. The cluster creates and
  asserts the roles in one turn; `startTestPostgres` clones after that turn has committed them. An
  arm that applies a chain of its own still takes the same turn (`ChainApplyTurn`) on the cluster's
  admin database.
- **Ask for the cluster unless a test reads the schema `startTestPostgres` builds.** An arm that
  only creates databases of its own paid a whole chain apply (~3.5 s locally) on a database nothing
  read, and queued on the turn for it (#1783). The cluster hands back no `dsn`, so a caller that
  does need the schema cannot be given the cluster by accident.
