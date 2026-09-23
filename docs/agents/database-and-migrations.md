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

## The serverless driver has no TCP path (re-verify when the dependency changes)

`@neondatabase/serverless` (still an edge dependency in `workers/edge/package.json`) connects only
over its WebSocket proxy: with no `wsProxy` configured it throws "No WebSocket proxy is
configured", and the bundle contains one `new WebSocket` and no `net` import. The offline Postgres
image in `packages/test-postgres` runs no ws proxy, so nothing that goes through this driver can
reach it; the edge's database lane runs the production Prisma client against that image instead
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
