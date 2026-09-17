# Native Pi session storage

Issue #1541 implements Pi 0.85.1 `Storage` and `SessionRepo` directly on the seven native tables of
the Prisma 8 contract from #1539, which #1626 widened to also declare the 19 catalog/users data-plane
tables. `NeonStorage` and `NeonSessionRepo` accept a native `PostgresClient<Contract>`; the caller
owns its connection lifecycle. The repository returns upstream `StorageBackedSession`.
Runtime admission, recovery and billing remain separate production writers.

The schema follows the [published SDK types](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/session/types.ts)
and [official SQLite backend](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/session-backends/sqlite-node/src/sqlite/migrations/001_initial.sql).

| Table | Authority |
| --- | --- |
| `pi_sessions` | Native `SessionMetadata` and the transaction's next sequence. Parent metadata is provenance; deleting a fork source does not invalidate a fork. |
| `pi_records` | Native `Entry` or `UsageRow` JSON with one shared identity and sequence namespace. |
| `pi_scalar_values` | Native value address, sequence and JSON value; row absence differs from a stored null. |
| `pi_list_values` | Native list address and sequence-indexed elements. |
| `agent_admissions` | The spec's `admission_intents`: stable session/client request key, model operation ID, identity, payer and reservation/refund coordinates. |
| `agent_open_operations` | The spec's `open_operations` auxiliary recovery index. No lease, queue or execution state. |
| `agent_settlements` | The spec's pending-settlement record: independently discoverable operation obligation, ledger cursor and `settled_at` guard. |

Reservations remain on their admission row. The conversation ledger (`sessions`,
`turn_reservations`) and the two usage meters (`anon_daily_message_count`, `daily_usage`) are
built by this chain as raw-SQL objects rather than contract tables: the database-layer spec §4.12
keeps the agent domain out of the contract, and `daily_usage.cost_usd` is `NUMERIC(14,6)`, which
Prisma 8's PSL cannot spell at all. `migrations/app/.../conversation-ledger.ts` and
`.../usage-meters.ts` install them and prove each object in `pg_catalog`. Native Pi tables receive only `agent_svc` grants; the 19 data-plane
tables follow the Atlas grant matrix in `access.ts`, and no role is created here — a disposable
test plane creates them for the cluster it owns (`@animichi/test-postgres`, #1625). Pi entries
and usage are append-only for that role; deleting a session removes its native rows by cascade.
One Prisma chain owns every table this package builds: the seven native tables and the 19
catalog/users data-plane tables rebuilt from `migrations/neon`. No applied Atlas migration is
altered, and no object has two owners. The migration-target ACs run against a per-test `template1`
database migrated only by that chain, and the shared fixture installs nothing on top of it, so
the suite no longer compares against an Atlas-built database.

`Storage.commit` holds the session row lock for the entire SQL transaction,
uses public `prepareStorageCommit` and `validateCommittedWrites`, advances `next_seq` for **every**
Write (including deletions), and returns the SDK result/read shapes. The same native validation
covers fork writers. A shared record table enforces entry/usage identity and sequence
uniqueness; ordinary checks prevent indexed fields diverging from the native JSON payload.
Native Pi validation owns visible parent references. Usage's optional `entryId` is not a foreign
key, matching upstream.

Native lists are supported. Pi 0.85.1's fork copies entries and scalars, **not lists**; domain state
and frozen-prefix correctness must not depend on list-preserving fork. No list-copy implementation
or conversion layer is introduced here.

`test/business-transactions.ts` contains executable SQL examples showing reservation replay and
atomic settlement of cursor, daily cost and refund. Production writers still need the actual
operation witness, live ownership and fault recovery protocols. Table presence or these examples
do not certify that host behavior. PostgreSQL transactions use Prisma 8's public runtime and
native query APIs. Direct `pg` queries in tests independently inspect constraints, grants and
conflicting pre-existing tables. Worker connections use Prisma's supported request-scoped lifecycle.

Prisma 8 rc.9 reparses JSON root strings after its PostgreSQL driver has already decoded them.
The pinned [native runtime patch](patches/@prisma__orm-target-postgres@8.0.0-rc.9.patch) leaves
JSON text decoding to Prisma's existing codecs. It changes only the runtime query parser for
JSON/JSONB and their SQL arrays; application values, codecs, control queries and global pg
parsers remain unchanged. `test/json-values.db.test.ts` retains the string regressions.

This is a temporary dependency correction, not an official Prisma release. Raw driver consumers
below the codec layer receive JSON wire text, and the distributed chunk's source map is not
regenerated. This package uses Prisma's typed runtime APIs. Remove the patch and its native pnpm
declaration together only after an exact official release passes the unchanged JSON-value,
array, transaction, marker and Worker checks without it. Patch application must fail on drift;
never disable the regression tests or convert root strings into another storage format.

After editing `src/contract.prisma`, run `contract:emit` and plan a migration from the intended
contract hash or ref. Release migration selection must use the chosen artifact's contract hash,
not the latest checkout. `test/migration-target.db.test.ts` applies the chain from zero on its own
`template1` database, proves replay changes nothing, proves an earlier head leaves the later node
pending, and covers B selected while C exists, backward refusal and conflicting pre-existing table
refusal.

Run `pnpm --filter @animichi/pi-session-neon test:integration` from the repository root. The existing
workspace discovery selects this package in the local affected gate and CI matrix automatically.

Each Storage handle queues admitted commits and fork snapshots. Fork reads use one native
repeatable-read transaction; destination publication is a separate atomic transaction. All ten
public conformance factories run against disposable PostgreSQL as `agent_svc`. The browser bundle
check excludes Node-only conformance and database-test infrastructure. Local conformance does not
measure a deployed APAC DO-to-Neon turn; that hosted latency gate remains outstanding.
