# Database migration boundary

This is the operational source of truth for schema changes in the hybrid runtime. It
separates the Neon data plane from the historical Supabase compatibility archive
(issue #1000) so a query schema cannot quietly become a second migration system.

## Authorities

| Surface | Source of truth | Apply mechanism | Boundary |
|---|---|---|---|
| Neon catalog, user and native agent data | `packages/pi-session-neon/src/contract.prisma` plus the emitted chain under `packages/pi-session-neon/migrations/` | Prisma 8's programmatic migration API, inside the migrator Worker | The only versioned schema history for Neon. The chain is schema-only; reference/seed data (e.g. the gazetteer at `workers/catalog/data/gazetteer_seed.sql`) is loaded separately and idempotently (`make seed-gazetteer`) |
| Catalog/users runtime access | `workers/catalog/src/db/schema.ts` and `workers/users/src/db/schema.ts` | Drizzle `neon-http` client with raw `sql` queries | Runtime column/type metadata and query typing only; never a migration source. #1629–#1631 move this onto Prisma |
| Supabase auth/legacy compatibility (**HISTORICAL**) | `supabase/migrations/` | **Not applied** — archived/historical only (issue #1000); never a live apply or source surface | The Prisma chain is the single authority; never a source for new Neon catalog or user tables |

The chain is append-only once a migration has reached a shared environment. Do not edit an
applied migration, hand-edit an emitted `migration.json` / `ops.json`, or copy a Drizzle schema
into a second migration source. The gazetteer seed (`workers/catalog/data/gazetteer_seed.sql`) is
a generated artifact and must stay out of the chain — it was removed from it in #847 and is
loaded via `make seed-gazetteer` after the schema exists.

The retired Atlas chain (`migrations/neon/*.sql` and its `atlas.sum`) was deleted in #1636: two
tools owning one database is the defect that made the first real production migration fail with
`42710`, because the release applied Atlas and then the Prisma baseline on the same DSN.

The application never runs migrations at startup. A Worker may construct a Drizzle client
and execute a query, but it must not import `drizzle-kit`, call a Drizzle migration API, or
run `drizzle-kit generate`, `migrate`, `push`, or `pull`.

## Approved pre-production history rewrite (2026-08-12, #992)

The persistence cutover (#992) is an **owner-approved one-time exception** to the append-only
policy: no business migration has reached production, so the business chain was rewritten in
place and rehashed instead of accumulating compatibility migrations. The rewrite, applied by
#993, makes the chain reproducible from an empty PostgreSQL 18 database and moves every
Animichi-owned persistent entity primary key to `uuid DEFAULT uuidv7()` (native PostgreSQL 18
`uuidv7()`):

- **Retired serial identities:** `aliases.id`, `cluster_version.id`, `itinerary_snapshots.id`
  (integer serial), `turn_reservations.id`, `messages.id` (bigint identity) — now `uuid`
  with a `uuidv7()` default; their `*_id_seq` sequences and grants were removed.
- **Default migration:** `feedback.id`, `request_log.id`, `saved_routes.id`, and the dropped
  `api_keys.id` moved from `gen_random_uuid()` to `uuidv7()`.
- **Unchanged external/semantic keys** (documented ownership): `sessions.id` (anonymous
  `anon_*` / Neon Auth subject), `bangumi.id`, `points.id`, `locations.id`,
  `media_assets.point_id` (Anitabi point id), `ingest_jobs.work_id`, `raw_anitabi.work_id`,
  `raw_bangumi.work_id`, memory operation/ledger ids, and composite keys
  (`daily_usage`, `anon_daily_message_count`, `leg_cache`, `location_aliases`,
  `saved_route_anime`, `series_edges`, `agent_memory.path`).

After this cutover, the normal append-only policy resumes for every shared environment.

## Authoring a Neon migration

1. Confirm that the change belongs to the Neon data plane and that an existing migration cannot
   be safely extended.
2. Author it in the contract — `packages/pi-session-neon/src/contract.prisma` — then emit the
   contract and plan the migration:

   ```bash
   make db-new NAME=add_routes_index     # prisma migration plan, in the chain's own package
   ```

   DDL the contract planner cannot express (grants, extensions, triggers, generated columns,
   operator-class and descending indexes) goes through that migration's `rawSql` operations, each
   with a postcheck that NAMES the object it proves; see
   [`packages/pi-session-neon/AGENTS.md`](../../packages/pi-session-neon/AGENTS.md).
3. Review its locking, constraints, indexes, and expand/contract compatibility with the currently
   deployed readers and writers, then check the graph:

   ```bash
   make db-lint       # prisma migration check — artifact integrity and a connected graph
   make db-status     # prisma migration list — the path and what is pending
   ```

   A check run is local/static evidence; it does not prove that a Neon branch accepted the DDL.
4. Run the affected tests and inspect the exact diff. Do not use Drizzle as a desired-state
   generator: the Drizzle files mirror the schema runtime queries need, and the contract remains
   authoritative.

## Applying a Neon migration

Migrations are applied only by CD, through
[`scripts/delivery/migrate-through-worker.sh`](../../scripts/delivery/migrate-through-worker.sh)
`<env>` (`staging` or `production`): CI proves GitHub OIDC, and the environment's migrator Worker
holds the migration DSN and applies the sealed chain. There is no manual or DSN-based apply — the
`db-push` targets that required `NEON_DATABASE_URL` in a developer's shell were deleted with the
Atlas chain, and never commit or print a connection URL. Ordering, and what each environment
proves, is in "CI and deployment order" below.

The Supabase CLI is not a substitute for this path. The archived `supabase/migrations/`
directory is historical and never applied; if an auth-only Supabase migration were explicitly
approved, it would follow its own owner/runbook and must not add or alter Neon data-plane tables.

## CI and deployment order

- Pull requests that affect the database dependency closure run `prisma migration check` and a
  fresh-schema apply to a disposable container in the single `CI` workflow. The
  migration-boundary tests assert that BOTH
  environments reach the database only through the OIDC-authenticated migrator and that `cd.yml`
  names no database credential at all (#1365). Neither path may reintroduce `supabase db push` or
  a Drizzle migration command.
- `.github/workflows/cd.yml` selects the affected set for each main SHA, builds one artifact, and
  applies the migration chain in the `CD / staging` job's migration unit — before its services,
  edge and web steps. Both
  environments run `scripts/delivery/migrate-through-worker.sh <env>` against their own migrator
  Worker, each with its own DSN and its own OIDC allowlist. There is no manual or tag-triggered
  alternate deploy path.
- **Expand/contract is a rule (US25/#1052)**: every schema change must be **compatible with the
  currently deployed consumers one version back**. Schema and component deploys are never
  atomic, so both deploy-order windows must stay safe by rule, not by luck:
  - **New schema, old code (rollout window)**: schema applies before components deploy, and
    components deploy one at a time — during the rollout some replicas still run the previous
    code against the new schema. New columns/indexes must be additive (add-only), and an
    existing column's type/constraint may only change if it remains readable/writable by the
    old consumers.
  - **Old schema, new code (rollback window)**: a Worker rollback never rolls back a database
    migration, so a rollback can put new code on the older schema. Any code merged after a
    migration must also tolerate the pre-migration shape (guard on missing columns, default
    values, optional reads) until the follow-up migration that removes the old shape has
    shipped. The removal itself is a **later** expand/contract step: add the replacement, deploy
    compatible readers/writers, confirm the old path is unused, then drop the old shape. A
    Worker rollback never rolls back a database migration.

## Verification boundary

Local `prisma migration check`, the disposable fresh-schema apply, CI static checks and mocked
tests prove repository consistency only. They do **not** prove that staging or production Neon
accepted the migrations, that the live marker is current, or that the deployed Worker can query
the expected branch.

After an approved staging apply, an operator should record the branch identity, the migrator's
`prismaTarget` and reported marker, expected table/extension probes, and the deploy smoke result
before promoting production. Keep the raw DSN and tokens out of logs and PRs.

## Related entry points

- [`packages/pi-session-neon/AGENTS.md`](../../packages/pi-session-neon/AGENTS.md) — the chain's own conventions and commands
- [`docs/ops/deployment.md`](./deployment.md) — deployment sequence and rollback limits
- [`docs/ops/neon-backup-rpo.md`](./neon-backup-rpo.md) — RPO/RTO, PITR, failed-migrate + bad-migration recovery
- [`.github/workflows/pr-verification.yml`](../../.github/workflows/pr-verification.yml) — affected PR/static gates
- [`.github/workflows/cd.yml`](../../.github/workflows/cd.yml) — main-only affected release orchestration
- [`scripts/delivery/migrate-through-worker.sh`](../../scripts/delivery/migrate-through-worker.sh) — the OIDC handshake CD applies staging migrations through
- [`workers/edge/test/migration-boundary.test.ts`](../../workers/edge/test/migration-boundary.test.ts) — static boundary guard
- [`docs/specs/2026-09-16-migration-apply-point-eval.md`](../specs/2026-09-16-migration-apply-point-eval.md) —
  why the apply point stays a platform-side executor and not application boot (#1039)

## Table ownership (D21) — parent [#830](https://github.com/lifeodyssey/animichi/issues/830) · [#829](https://github.com/lifeodyssey/animichi/issues/829)

Moved here from `migrations/AGENTS.md` when that directory was deleted with the Atlas chain
(#1636). Rows whose table the Prisma chain does not build are marked **retired**: a rebuilt chain
does not declare a table with no consumer, so it does not exist.

Owner service = BC that may **write** the table under greenfield. Reads may be broader (e.g. jobs SELECT).

| Table (today) | Owner service | Notes / greenfield |
| --- | --- | --- |
| `bangumi`, `points`, `aliases`, `series_edges` | **catalog** | Master data |
| `ingest_jobs`, `cluster_version`, `raw_anitabi`, `raw_bangumi`, `media_assets` | **catalog** | Pipeline |
| `leg_cache` | **catalog** | Transit cache |
| `locations`, `location_aliases` | **catalog** | Gazetteer |
| `route_snapshots` | **catalog** | Target name `itinerary_snapshots` |
| `saved_routes` | **users** | Renamed from `routes` (#852 P1); user document |
| `saved_route_anime` | **users** (FK to saved_routes) | Renamed from `route_anime` (#852 P1); SavedRoute–Bangumi link |
| `sessions` | **agent** | Conversation ownership; the edge reads and writes it through bounded raw SQL. `conversations` / `conversation_messages` were never built |
| `runs`, `run_steps` | **agent** | **Retired**: their only writer was the Python agent (#1607), so the rebuilt chain does not declare them |
| `agent_memory`, `agent_memory_operations`, `agent_memory_metadata` | **agent** | **Retired** with the Python agent (#1607) |
| `photo_offers` | **agent** | **Retired**: #1604 deleted the photo search API and the namespace never gained a reader |
| `turn_reservations` | **agent** | The turn ledger; the adoption route writes its markers by constraint name |
| `daily_usage`, `anon_daily_message_count` | **agent** (write) | Quota / metering |
| `pi_sessions`, `pi_records`, `pi_scalar_values`, `pi_list_values` | **agent** | Native Pi session storage |
| `agent_admissions`, `agent_open_operations`, `agent_settlements` | **agent** | Admission, recovery and settlement obligations |
| `request_log`, `feedback`, `api_keys` | **agent** / platform | **Retired**: `api_keys` with AUTH-1 (#945), the other two with the Python agent (#1607) |
| `user_memory` | **users** when awake | Dropped once; reintroduce under Users BC only |

Legacy / unknown: if a table is not listed, treat as **needs classification** before GRANT widen.

## Intended role matrix (N1 — schema as code; wire in #831/#832)

| Role | Login? | Purpose |
| --- | --- | --- |
| **migrator** | LOGIN (migrator Worker's Secrets Store binding only) | Applies the Prisma chain; DDL + the `prisma_contract` marker schema. **Never** app runtime. |
| **catalog_svc** | LOGIN or NOLOGIN+SET (env-specific) | Catalog worker: CRUD on catalog-owned tables; **no** write to `saved_routes` |
| **agent_svc** | same | Agent: sessions/messages/memory/quota; **no** Point master write |
| **users_svc** | same | Users worker: SavedRoute (+ share/checkin when built); **no** points write |
| **readonly** | LOGIN optional | Human/analytics SELECT-only |

### RLS stance

Application-layer authorization remains authoritative this campaign. RLS is **not** reintroduced as primary auth (Neon cutover stripped Supabase policies). Optional defense-in-depth only via a future migration if product requires.

### Related

- Capability map: `docs/specs/2026-08-06-neon-dba-capability-map.md` (land with design docs / #833)
- Runtime DSN wiring: #832 (staging) · #855 (prod HITL)
- #685 GRANT-as-decoration debt
