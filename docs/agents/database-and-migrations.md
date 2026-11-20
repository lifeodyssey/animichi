# Neon and the migration chain from an agent's seat

The schema and query layer is `docs/specs/2026-09-12-prisma8-database-layer-spec.md`; the
runbooks are `docs/ops/migrations.md` and `docs/ops/neon-backup-rpo.md`. This file keeps what an
agent learned the hard way against the live branches. Identifiers (project, branches, endpoints)
are not repeated here; they are in the machine-local notes `AGENTS.md` points to.

## Roles are branch-scoped, and production has none (2026-09-23)

Read-only checks on 2026-09-23: on staging, `agent_svc`, `catalog_svc`, `users_svc` and
`migrator` are members of `neon_superuser`, granted by `cloud_admin`; none of our roles holds the
ADMIN OPTION, so the membership cannot be revoked. A role created through the Neon API, console
or CLI joins `neon_superuser` automatically; a role created by SQL does not.
`infra/database-access/index.ts` creates `migrator` with Pulumi `neon.Role`, and its comment says
roles are project-scoped; they are branch-scoped, and the production branch has no service roles
at all, `migrator` included. The chain's access step
(`packages/pi-session-neon/migrations/app/20260913T1711_data_plane_baseline/access.ts`) prechecks
that all five service roles exist, so the first production migration stops there today.

Owner decision, 2026-09-23 ("按方案做"): service roles are created by SQL, run by the migrator
Worker before the chain, with passwords from Pulumi `random.RandomPassword`; `migrator` stays a
`neon.Role` because `CREATE EXTENSION` needs it. This amends §4.8.5 of the Prisma spec ("角色与
GRANT 归 Pulumi"). Why not Pulumi: it runs in CI, and CI may hold no database credential
(`.github/test/cd-credentials.test.rb`), so Pulumi can only reach the Neon API. #1915 carries
the change. Why it matters:
a leaked runtime DSN with superuser membership is full read-write on the whole database, and every
precise GRANT is decoration.

## Two PostgreSQL facts that froze delivery

- `ALTER TABLE` needs table ownership, and `ADD COLUMN IF NOT EXISTS` checks ownership before
  existence. On 2026-08-24 the staging `sessions` table, owned by `neondb_owner` from before the
  current chain, could not be altered by `migrator` (`must be owner of table`), and every chat turn
  failed on `INSERT INTO sessions`.
- A migration that fails freezes the whole CD chain: the stage's later jobs are skipped, nothing
  deploys, and the merged PR looks fine. Watch the migration step, not the merge.

## CD migrates before it publishes (2026-11-19)

Both CD stages run "Apply the selected migration chain" before "Publish the selected services"
(`.github/workflows/cd.yml`; `.github/test/cd-stage.test.rb` pins the order). In run 44493870952
the staging chain step started at 09:11:57Z and the publish step at 09:12:07Z: between them the
new schema serves the old code. A migration that removes something the old code still writes
breaks that window, so split it expand–contract across two PRs, or prove the old code survives
it, with a case for the behaviour the proof rests on (`docs/agents/review-and-verification.md`).
`docs/ops/deployment.md` states the rule under "Schema change policy" and the step order under
"Migration promotion". #2076 is the first half of such a split, and its body gives this window as
the reason: it stops writing `cluster_version` and leaves the drop to a second PR, because a drop
in the same release would have failed every publish of the old catalog code in that window. CD
may skip `main` commits, so each half also needs its own release in each environment: approving
production for a snapshot that carries both halves is the same-release drop again.

## The test template follows the emitted contract; a revert cannot undo a drop (2026-11-20)

Read in the installed Prisma 8.0.0-rc.8 (CLI) and rc.9 (migrator) for the chain's first table
drop, `drop_cluster_version_tables`. Re-read both after a Prisma upgrade.

- `prisma db migrate` without `--to`, which `packages/test-postgres` uses to seed its migrated
  template, targets the emitted `src/contract.json`, not the newest migration. The template is
  named after the migration directories alone, and seeding reads no marker. So a tree whose
  `contract.json` lags its chain seeds the template at the old head under the new chain's name,
  and every lane that clones it is green with nothing applied. Restoring an older
  `contract.json` to run old code against a new schema makes exactly such a tree. Seed the
  template from the intact tree first, and check a clone's `prisma_contract.marker` before
  trusting such a run.
- Prisma's runner wraps an apply in one transaction, marker included
  (`PostgresMigrationRunner.execute` in `@prisma/orm-target-postgres` 8.0.0-rc.9). For this one
  migration in the app space,
  `packages/pi-session-neon/test/drop-cluster-version-tables.db.test.ts` pins it: a drop that
  fails rolls back whole and leaves the marker where it was. Applies of several migrations or
  contract spaces are read from the runner's source, not tested. After a failed drop, reverting
  the PR unfreezes CD, because the selected target equals the live marker. Once a drop has
  applied, a revert does the opposite: the reverted chain has no path from the live marker, the
  preflight refuses, and CD stays frozen until a forward fix or a PITR.

## The serverless driver has no TCP path (re-verify when the dependency changes)

`@neondatabase/serverless` (still an edge dependency in `workers/edge/package.json`) reaches
Postgres over HTTP or over its WebSocket proxy, never over TCP. The installed 1.1.0 README states
the split: a `neon()` query is carried by an https fetch request, while `Pool` and `Client`
queries are carried by WebSockets ("https and WebSockets in place of TCP"). Only the WebSocket
path throws "No WebSocket proxy is configured" when no `wsProxy` is configured, and the bundle
contains one `new WebSocket` and no `net` import. The offline Postgres image in
`packages/test-postgres` runs no ws proxy, so nothing that goes through this driver can reach it;
the edge's database lane runs the production Prisma client against that image instead
(`workers/edge/agent-db-test/README.md`).

## `neonctl` traps and remote writes (2026-09-08)

- `neonctl connection-string` takes the branch as a positional argument; `--branch` and
  `--branch-id` are silently ignored and the command answers for the default branch, which is
  production. Branches with several roles also need `--role-name`. One misdirected connection
  reached production and wrote nothing only because the table did not exist.
- Before any write to a remote database, run a read-only query that proves the endpoint and the
  pre-state (row counts of the tables about to change), then execute.

## Count round trips by timing, never by ORM logs (2026-08-24)

An ORM's `BEGIN`/`ROLLBACK` log lines are its own logical markers, not statements on the wire.
Switching a read-only session to autocommit left the log unchanged and took the real Neon read
from 789 ms to 208 ms, one RTT. Method: time N identical operations, divide
the mean by the measured RTT, and read the integer. Do this against the real database before
touching call sites for a "fewer round trips" change.
