import test from "node:test";
import assert from "node:assert/strict";
import { URL, fileURLToPath } from "node:url";
import {
  dailyUsage,
  messages,
  runSteps,
  runs,
  sessions,
  MESSAGE_ROLES,
  RUN_FAILURE_REASONS,
  RUN_PAYERS,
  RUN_STATUSES,
  USAGE_SCOPES,
} from "../src/db/schema.ts";
import { RunFailureReason, SessionRunStatus } from "@animichi/contract/agent-contract";
import { readMigrationSchema, type ColumnSchema } from "./migration-schema.ts";
import { readMappedTable } from "./mapped-table.ts";

// W1-1 (#1250): the storage the intake and the AgentSession DO write. Two
// guarantees are pinned here. First, the turn contract itself — which columns a
// run has, which of them stay empty until something settles the turn, which
// unique keys make the intake's dedupe and one-run-per-message structural, and
// which values a status, a payer, or a failure reason may take. Second, that
// the Drizzle mapping and the Atlas chain still describe the same tables: the
// second group reads `migrations/neon` rather than a transcription of it, so a
// column, a domain, a key, or a primary key added on one side only fails here.

const MIGRATIONS = fileURLToPath(new URL("../../../migrations/neon", import.meta.url));
const migrated = readMigrationSchema(MIGRATIONS);
const mapped = new Map([
  ["runs", readMappedTable(runs)],
  ["messages", readMappedTable(messages)],
  ["run_steps", readMappedTable(runSteps)],
  // The day aggregate a settled turn is banked into (#1255). Mapped here for
  // the same reason the turn tables are: `runs.payer` is written into
  // `daily_usage.scope` verbatim, so the scope vocabulary has to keep
  // containing the payer one without anyone re-typing either of them.
  ["daily_usage", readMappedTable(dailyUsage)],
  // The conversation a transcript hangs off (#1254). Mapped for its ownership
  // column alone, and held to the chain here for the same reason as the rest:
  // `ConversationRetrieval` refuses a session it cannot prove the caller owns,
  // so `sessions.user_id` moving underneath that check has to fail somewhere.
  ["sessions", readMappedTable(sessions)],
]);

/** Run columns that carry no value until a lease is taken or the turn settles. */
const NULLABLE_RUN_COLUMNS = [
  "failure_reason",
  "lease_owner",
  "lease_expires_at",
  "finished_at",
  "quota_identity_id",
  "quota_usage_date",
  "quota_refunded_at",
  "usage_settled_at",
];

/** Run columns the intake must supply or the database must default. */
const REQUIRED_RUN_COLUMNS = [
  "id",
  "session_id",
  "message_id",
  "status",
  "deadline_at",
  "started_at",
  "payer",
  "input_tokens",
  "output_tokens",
  "cost_usd",
];

const runColumns = readMappedTable(runs).columns;

void test("runs carries the whole turn contract and nothing else", () => {
  for (const name of REQUIRED_RUN_COLUMNS) assert.equal(runColumns.get(name)?.notNull, true, name);
  for (const name of NULLABLE_RUN_COLUMNS) assert.equal(runColumns.get(name)?.notNull, false, name);
  assert.deepEqual(
    [...runColumns.keys()].sort(),
    [...REQUIRED_RUN_COLUMNS, ...NULLABLE_RUN_COLUMNS].sort(),
  );
});

void test("runs pins the vocabularies the client and the reclaim scan read", () => {
  assert.deepEqual(runColumns.get("status")?.values, [...RUN_STATUSES]);
  assert.deepEqual(runColumns.get("payer")?.values, [...RUN_PAYERS]);
  assert.deepEqual(runColumns.get("failure_reason")?.values, [...RUN_FAILURE_REASONS]);
  assert.equal(runColumns.get("status")?.hasDefault, true);
});

/**
 * The meter admits every payer, plus one nobody can be (#1292).
 *
 * Asserted as a RELATIONSHIP rather than as two literal lists, because that is
 * what the settlement relies on: a settled run's payer is written into
 * `daily_usage.scope` unchanged, so the scope domain must contain the payer
 * domain — and `platform`, the scope for spend no caller asked for, must not
 * leak back into the payers a turn can be committed on.
 */
void test("the usage meter's scopes are every payer plus the platform", () => {
  const scopes = readMappedTable(dailyUsage).columns.get("scope")?.values;
  assert.deepEqual(scopes, [...RUN_PAYERS, "platform"]);
  assert.deepEqual(scopes, [...USAGE_SCOPES]);
  assert.equal(RUN_PAYERS.includes("platform" as (typeof RUN_PAYERS)[number]), false);
  assert.deepEqual(
    migrated.get("daily_usage")?.checkVocabularies.get("daily_usage_scope_check"),
    [...USAGE_SCOPES],
  );
});

/** The third mirror of the same vocabularies: the wire. `runs.status` and
 * `runs.failure_reason` reach the browser through the run field on
 * `GET /v1/conversations/:id/messages` (#1254), so a value the database may
 * hold and the contract may not is a payload the client refuses to parse. */
void test("the published run status speaks the database's own vocabularies", () => {
  assert.deepEqual(SessionRunStatus.shape.status.options, [...RUN_STATUSES]);
  assert.deepEqual(RunFailureReason.options, [...RUN_FAILURE_REASONS]);
});

void test("one run per message, one running run per session, one message per id", () => {
  const messageColumns = readMappedTable(messages).columns;
  assert.deepEqual(readMappedTable(runs).uniqueKeys.get("runs_message_id_key"), ["message_id"]);
  assert.deepEqual(readMappedTable(runs).uniqueKeys.get("runs_one_running_per_session"), [
    "session_id",
  ]);
  assert.deepEqual(readMappedTable(messages).uniqueKeys.get("messages_session_client_message_id"), [
    "session_id",
    "client_message_id",
  ]);
  assert.equal(messageColumns.get("client_message_id")?.notNull, false);
  assert.deepEqual(messageColumns.get("role")?.values, [...MESSAGE_ROLES]);
});

void test("run_steps is keyed by the tool-step idempotency key", () => {
  const steps = readMappedTable(runSteps);
  // Asserted against the migration, not the mapping: Drizzle reports a composite
  // key in column-declaration order, so it cannot witness the SQL's key order.
  assert.deepEqual(migrated.get("run_steps")?.primaryKey, ["run_id", "step_index"]);
  assert.equal(steps.columns.get("result")?.notNull, false);
  assert.equal(steps.columns.get("finished_at")?.notNull, false);
  assert.equal(steps.columns.get("input")?.notNull, true);
  assert.equal(steps.columns.get("tool_name")?.notNull, true);
});

void test("the Drizzle mapping and the Atlas chain declare the same columns", () => {
  for (const [name, table] of mapped) {
    const declared = migrated.get(name)?.columns ?? new Map<string, ColumnSchema>();
    assert.deepEqual([...table.columns.keys()].sort(), [...declared.keys()].sort(), name);
    for (const [column, facts] of table.columns) {
      assert.equal(facts.notNull, declared.get(column)?.notNull, `${name}.${column} NOT NULL`);
      assert.equal(facts.hasDefault, declared.get(column)?.hasDefault, `${name}.${column} DEFAULT`);
    }
  }
});

void test("every mapped value domain matches its CHECK constraint", () => {
  const checked = [...mapped].flatMap(([name, table]) =>
    [...table.columns].filter(([, facts]) => facts.values.length > 0).map(([column, facts]) => ({ name, column, facts })),
  );
  assert.equal(checked.length, 5, "run status, payer, failure_reason, message role, usage scope");
  for (const { name, column, facts } of checked) {
    const declared = migrated.get(name)?.checkVocabularies.get(`${name}_${column}_check`);
    assert.deepEqual(facts.values, declared, `${name}.${column}`);
  }
});

void test("every mapped primary key matches the Atlas chain", () => {
  for (const [name, table] of mapped) {
    assert.deepEqual(table.primaryKey, migrated.get(name)?.primaryKey, name);
  }
});

void test("every mapped unique key matches a unique key in the Atlas chain", () => {
  const keys = [...mapped].flatMap(([name, table]) =>
    [...table.uniqueKeys].map(([key, columns]) => ({ name, key, columns })),
  );
  assert.equal(keys.length, 3, "one run per message, one running run per session, one message per client id");
  for (const { name, key, columns } of keys) {
    assert.deepEqual(columns, migrated.get(name)?.uniqueKeys.get(key), `${name}.${key}`);
  }
});
