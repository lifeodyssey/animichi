# pi-session-neon — AGENTS.md

Native Pi Storage/SessionRepo and agent business obligations. Root guide: `../../AGENTS.md`.
Prisma 8 owns every object this package's chain builds through `src/contract.prisma` and native
`migrations/`: the seven native agent tables plus the 19 catalog/users data-plane tables adopted
from the retired chain this one replaced, and — as raw SQL rather than contract tables — the
conversation ledger and the two usage meters `workers/edge/src` still writes
(`conversation-ledger.ts`, `usage-meters.ts`). One authority owns the whole data plane (#1636).
No object has two migration owners; do not re-declare an object the chain already builds.

- `pnpm run lint` — type-aware oxlint, warnings denied.
- `pnpm run typecheck` — TypeScript 7.
- `pnpm run test` — the `*.unit.test.ts` files plus `test/contract-types.test.ts`, with no
  container and no coverage gate. It is where those unit files run; `test:integration` stopped
  globbing them in #1771, and the retired `test:unit` named exactly this list.
- `pnpm run test:integration` — Node's test runner, one reused test-postgres container and a
  disposable database of its own. `--test-isolation=none` shares the imported setup and serial
  tests; each test resets that database. Never point these tests at a live Neon database.
  `test/postgres.ts` creates the shared database from pristine `template0` and migrates it with
  this chain, which builds every object the suites touch; the migration-target ACs create their
  own `template0` database the same way. Both are created on the cluster `startTestPostgresCluster`
  opens, which applies no chain of its own (#1783) — one chain per database.
  Node's native coverage enforces 95% lines on `src/` and writes `coverage/lcov.info` for CI.

The owner approved three exceptions for Prisma's generated output, and only that output:
`consistent-type-definitions` and `no-empty-object-type` on 2026-09-10, plus `array-type` on
2026-09-14 because each emitted contract declares four `ReadonlyArray<T>` properties that the
generator cannot emit as `readonly T[]`. Package `.oxlintrc.json` limits all three exceptions
to exactly `src/contract.d.ts` and `migrations/snapshots/*/contract.d.ts`; handwritten code,
editable migrations and every other generated path keep the full rule set, and TypeScript keeps
`skipLibCheck: false`. Never regenerate the contracts to silence a rule.

Separately, for #1626 the owner approved on 2026-09-14 one exception to root `AGENTS.md`'s
300-line file cap: `packages/pi-session-neon/src/contract.prisma` may exceed it, because Prisma 8's
loader reads exactly one contract source file (a directory path fails `CONTRACT.SOURCE_LOAD_FAILED`
/ `EISDIR`) and its 315 non-comment lines cannot be formatted under the cap. No other path is
exempt: every other handwritten file in the package remains subject to that cap.

The contract stores published Pi 0.87.1 `Entry`, `UsageRow` and `SessionMetadata` directly.
Do not create a custom Session, transcript converter, TurnStore or operation state machine.
The public entry exports `NeonStorage` and `NeonSessionRepo`, accepting native
`PostgresClient<Contract>`; the caller owns its lifecycle. All ten public conformance factories
run as `agent_svc`. Repositories return upstream `StorageBackedSession`; native commit validation
and fork snapshots remain authoritative. Admitted commits/snapshots queue per handle, while
PostgreSQL transactions and a session row lock own durable sequencing.
The business SQL examples under `test/` prove schema constraints and PostgreSQL transactions;
production admission, recovery and settlement must test their actual writers in their own cards.

`@animichi/test-postgres`, `pg` and Node APIs are test-only. Production callers provide
Prisma's supported Worker connection lifecycle. The browser bundle test rejects Node-only
conformance/test imports. Deployed APAC latency and real-tool measurements remain pending.

Author contract changes in Prisma's PSL, run `contract:emit`, then use native `migration plan`
with an explicit origin when no development ref exists. Regenerate edited native migrations
through `pnpm run migration:emit -- migrations/app/<dir>`, which runs the rendered `migration.ts`;
never hand-edit generated hashes or SQL bundles. Prisma's emitters write JSON without a final
newline, so both entrypoints finish by restoring it (`scripts/generated-artifacts.ts`) — a
regenerated tree is already `end-of-file-fixer`-clean, and running either entrypoint twice
leaves no diff.
`rawSql` is spec §4.1's escape hatch for what the contract planner does not express: grants and
role prechecks, extensions, trigger functions and triggers, generated columns, the
operator-class / descending index DDL schema verification cannot read, and the agent tier's
own ledger and meters — `daily_usage.cost_usd` is `NUMERIC(14,6)` and Prisma 8's PSL carries no
precision or scale. Every object installed that way gets a postcheck that NAMES it, because
`db verify` ignores what the contract does not claim. Install that DDL exactly and prove the
semantics in `pg_catalog` (`data-plane-indexes.ts`), because dropping them to match the
introspectable IR weakens live PostgreSQL. Runtime record validation belongs to native Pi
session APIs.

The chain this one replaced was deleted in #1636, so there is nothing left to consult: this
package's contract and `migrations/app/` are the whole record of what a database contains. The two
unpublished #1539 draft migrations were replaced by that two-node chain. The omissions —
`points.embedding` and `idx_points_embedding`, `locations.location`, and every agent-domain table
with no live reader — are authorized by `docs/specs/2026-09-12-prisma8-database-layer-spec.md`
§4.8.3–§4.8.4 and §4.12, not by #1539. The four `workers/edge/src` still reads — `sessions`,
`turn_reservations`, `daily_usage`, `anon_daily_message_count` — are built here, carrying every
column a live statement names and no other.

One frozen copy of the shape this chain replaced survives as a TEST FIXTURE
(`packages/test-postgres/sql/drizzle-era-catalog.sql`). Two test lanes read it: the agent's
catalog-tool lane (`packages/agent/integration-test/catalog-postgres.ts`) installs it on a database
of its own, because its `catalog-seed.ts` writes the scalar `points` coordinates the Prisma plane
generates; and `workers/catalog/test/geocode-migration-parity.node.test.ts` reads it as text
to pin the table shapes its geocode seed relies on. It is not an authority and nothing applies
it to a shared or live database; it goes when neither lane needs the pre-Prisma shape any more.
