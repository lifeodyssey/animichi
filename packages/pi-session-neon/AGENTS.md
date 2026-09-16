# pi-session-neon — AGENTS.md

Native Pi Storage/SessionRepo and agent business obligations. Root guide: `../../AGENTS.md`.
Prisma 8 owns every object this package's chain builds through `src/contract.prisma` and native
`migrations/`: the seven native agent tables plus the 19 catalog/users data-plane tables adopted
from `migrations/neon/`. `migrations/neon/` is read-only evidence of the objects the baseline
replaced until W4 deletes it — it owns nothing here. No object has two migration owners; do not
re-declare an object the chain already builds.

- `pnpm run lint` — type-aware oxlint, warnings denied.
- `pnpm run typecheck` — TypeScript 7.
- `pnpm run test:integration` — Node's test runner, one reused test-postgres container and a
  disposable database of its own. `--test-isolation=none` shares the imported setup and serial
  tests; each test resets that database. Never point these tests at a live Neon database.
  `test/postgres.ts` creates the shared database from pristine `template1`, migrates it with this
  chain, then installs the two #1607 quota aggregates; the migration-target ACs create their own
  chain-only `template1` database with no aggregates. Neither reads the database
  `startTestPostgres` migrates for its own call — one chain per database.
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

The contract stores published Pi 0.85.1 `Entry`, `UsageRow` and `SessionMetadata` directly.
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
role prechecks, extensions, trigger functions and triggers, generated columns, and the
operator-class / descending index DDL schema verification cannot read. Install that DDL exactly
and prove the semantics in `pg_catalog` (`data-plane-indexes.ts`), because dropping them to match
the introspectable IR weakens live PostgreSQL. Runtime record validation belongs to native Pi
session APIs.

Atlas SQL under `migrations/neon/` is immutable, read-only evidence of the objects #1626's native
Prisma chain replaced; only W4 deletes it, and this package drops no old table. The two unpublished
#1539 draft migrations were replaced by that two-node chain. The omissions here — `points.embedding`
and `idx_points_embedding`, `locations.location`, and the 12 agent-domain tables — are authorized by
`docs/specs/2026-09-12-prisma8-database-layer-spec.md` §4.8.3–§4.8.4 and §4.12, not by #1539.
