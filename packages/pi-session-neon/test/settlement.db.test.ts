import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptedReservation, businessBalances, insertAdmission, STAMP } from "./business-records.ts";
import { settle } from "./business-transactions.ts";
import { database, pool } from "./postgres.ts";

/** The stamp `2026-09-09T09:00:00.123456+09:00` as the client reads it back. */
const READ_BACK = "2026-09-09T00:00:00.123456Z";
const RESERVED_BALANCES = [
  [{ operationId: "operation", lastUsageSeq: -1, settledAt: null }],
  [], [{ count: "1" }], [{ state: "accepted", quotaRefundedAt: null }],
];

void test("an unsettled obligation remains discoverable without an open-operation row", async () => {
  await acceptedReservation();
  await database.orm.public.AgentOpenOperation.where((row) => row.operationId.eq("operation")).delete();
  const rows = await database.orm.public.AgentSettlement.where((row) => row.settledAt.isNull()).select("operationId").all();
  assert.deepEqual(rows, [{ operationId: "operation" }]);
});

void test("replaying settlement advances the cursor, cost and refund exactly once", async () => {
  await acceptedReservation();
  await database.runtime().execute(settle());
  await database.runtime().execute(settle());
  assert.deepEqual(await businessBalances(), [
    [{ operationId: "operation", lastUsageSeq: 4, settledAt: STAMP }],
    [{ requests: "1", cost: "0.300000" }], [{ count: "0" }],
    [{ state: "settled", quotaRefundedAt: STAMP }],
  ]);
});

// Since Prisma 8 rc.21 (`iso-string-date-time-values`) a `TimestamptzString` reads as its UTC instant in
// ISO 8601, keeping every fractional digit the column holds, whatever offset wrote it. Consumers rely on
// that form: the catalog's ingest claim binds the `started_at` it read back into its fenced update, which
// matches only if the read kept the stored instant exactly.
void test("a settlement stamp reads back as its UTC instant with every digit, and binding that text finds the row", async () => {
  await acceptedReservation();
  await database.orm.public.AgentSettlement.where((row) => row.operationId.eq("operation"))
    .update({ settledAt: "2026-09-09T09:00:00.123456+09:00" });
  assert.deepEqual(await database.orm.public.AgentSettlement.select("settledAt").all(), [{ settledAt: READ_BACK }]);
  const fenced = database.orm.public.AgentSettlement.where((row) => row.settledAt.eq(READ_BACK));
  assert.deepEqual(await fenced.select("operationId").all(), [{ operationId: "operation" }]);
});

void test("failed settlement rolls back its ledger cursor, charge and refund marker", async () => {
  await acceptedReservation();
  await assert.rejects(database.transaction(async (tx) => {
    await tx.execute(settle());
    throw new Error("settlement interrupted");
  }), /settlement interrupted/);
  assert.deepEqual(await businessBalances(), RESERVED_BALANCES);
});

void test("duplicate settlement and discovery keys cannot create another obligation", async () => {
  await acceptedReservation();
  await assert.rejects(pool.query("INSERT INTO agent_settlements (operation_id) VALUES ('operation')"), { code: "23505" });
  await assert.rejects(pool.query("INSERT INTO agent_open_operations (operation_id) VALUES ('operation')"), { code: "23505" });
});

void test("business obligations require an admission and a valid initial ledger cursor", async () => {
  await assert.rejects(pool.query("INSERT INTO agent_settlements (operation_id) VALUES ('unknown')"), { code: "23503" });
  await insertAdmission();
  await assert.rejects(pool.query("INSERT INTO agent_settlements (operation_id, last_usage_seq) VALUES ('operation', -2)"), { code: "23514" });
});
