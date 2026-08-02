# Database migration boundary

This is the operational source of truth for schema changes in the hybrid runtime. It
separates the Neon data plane from the remaining Supabase authentication/compatibility
surface so a query schema cannot quietly become a second migration system.

## Authorities

| Surface | Source of truth | Apply mechanism | Boundary |
|---|---|---|---|
| Neon catalog and user data | `db/migrations/*.sql` plus the generated `db/migrations/atlas.sum` | Pinned Atlas CLI (`0.30.0`) | The only versioned schema and data migration history for Neon |
| Catalog/users runtime access | `workers/catalog/src/db/schema.ts` and `workers/users/src/db/schema.ts` | Drizzle `neon-http` client with raw `sql` queries | Runtime column/type metadata and query typing only; never a migration source |
| Supabase auth/legacy compatibility | `supabase/migrations/` | Supabase CLI, only when an auth owner explicitly schedules it | Not a source for new Neon catalog or user tables |

`db/migrations/` is append-only once a migration has reached a shared environment. Do not
edit an applied file, hand-edit `atlas.sum`, or copy a Drizzle schema into a second SQL
directory. `supabase/neon/` is not an active migration directory; new Neon changes belong
under `db/migrations/`.

The application never runs migrations at startup. A Worker may construct a Drizzle client
and execute a query, but it must not import `drizzle-kit`, call a Drizzle migration API, or
run `drizzle-kit generate`, `migrate`, `push`, or `pull`.

## Authoring a Neon migration

1. Confirm that the change belongs to the Neon catalog/user data plane and that an existing
   migration cannot be safely extended. Use a new UTC timestamped file in `db/migrations/`.
2. Write the SQL migration and review its locking, constraints, indexes, and expand/contract
   compatibility with the currently deployed readers and writers. Atlas owns ordering and
   the revision ledger; do not split statements or execute ad-hoc SQL in application code.
3. Recompute the integrity manifest and validate the directory:

   ```bash
   atlas migrate hash --dir file://db/migrations
   atlas migrate validate --dir file://db/migrations
   ```

   `atlas.sum` must be part of the same change. A hash-only run is local/static evidence; it
   does not prove that a Neon branch accepted the SQL.
4. Run the affected SQL/static tests and inspect the exact diff. Do not use Drizzle as a
   desired-state generator for this repository. The Drizzle files mirror the schema needed
   by runtime queries and types; the SQL files remain authoritative.

## Applying a Neon migration

The deploy workflows apply the same checked-in directory before deploying the Worker that
uses it. The connection URL is environment-scoped and must never be committed or printed:

```bash
atlas migrate apply \
  --dir "file://db/migrations" \
  --url "$NEON_DATABASE_URL" \
  --revisions-schema public
```

The deploy lane scopes the connection URL to `search_path=public` when the database also
contains the `neon_auth` schema. It keeps Atlas's clean-database check enabled and does not
use `--allow-dirty`.

For a non-mutating review against a disposable or explicitly approved target, use the same
command with `--dry-run`. CI always runs `atlas migrate validate`; a live dry-run/apply only
runs when the corresponding protected connection secret is present.

The Supabase CLI is not a substitute for this command. If an auth-only Supabase migration is
explicitly approved, it follows its own owner/runbook and must not add or alter Neon data-plane
tables.

## CI and deployment order

- Pull requests and migration-path changes run the static Atlas checksum/SQL validation. The
  worker migration-boundary test also checks that workflows contain the Atlas command and do
  not reintroduce `supabase db push` or a Drizzle migration command.
- The main promotion workflow applies Atlas to the target Neon branch before the catalog/users
  Worker rollout. The manual production workflow validates the directory but intentionally does
  not mutate a production database; use the approval-gated promotion for schema changes.
- A schema change that needs both old and new application versions uses expand/contract:
  add the replacement, deploy compatible readers/writers, then remove the old shape in a later
  migration. A Worker rollback never rolls back a database migration.

## Verification boundary

Local `atlas migrate hash`, `atlas migrate validate`, CI static checks, and mocked tests prove
repository consistency only. They do **not** prove that staging or production Neon accepted the
migrations, that the Atlas revision ledger is current, or that the deployed Worker can query the
expected branch. Those claims remain **UNVERIFIED** in this change because no live Neon/Atlas
apply is authorized here.

After an approved staging apply, an operator should record the branch identity, Atlas status,
expected table/extension probes, and the deploy smoke result before promoting production. Keep
the raw DSN and tokens out of logs and PRs.

## Related entry points

- [`db/AGENTS.md`](../../db/AGENTS.md) — migration conventions and pinned commands
- [`docs/ops/deployment.md`](./deployment.md) — deployment sequence and rollback limits
- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — PR/static and promotion gates
- [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) — manual production path
- [`worker/migrationBoundary.test.ts`](../../worker/migrationBoundary.test.ts) — static boundary guard
