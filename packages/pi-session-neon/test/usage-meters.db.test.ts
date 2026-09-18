// The chain's `usage-meters` operation, proved on the database it migrates. Settlement reaches
// both meters through raw SQL and relies on two shapes the contract cannot declare:
// `daily_usage.cost_usd`'s NUMERIC(14,6) rounding and the four-value scope vocabulary.
import assert from "node:assert/strict";
import { test } from "node:test";
import { columnNames, explicitAgentGrants } from "./installed-table.ts";
import { pool } from "./postgres.ts";

const DAY = "2026-09-18";
const SCOPES = ["anon", "user", "byok", "platform"];

const INSERT_COST = `INSERT INTO daily_usage (usage_date, scope, cost_usd) VALUES ($1::date, $2, $3)
  RETURNING cost_usd::text AS cost`;

void test("the meter tables carry exactly the columns settlement names", async () => {
  assert.deepEqual(await columnNames(pool, "daily_usage"),
    ["cost_usd", "input_tokens", "output_tokens", "requests", "scope", "updated_at", "usage_date"]);
  assert.deepEqual(await columnNames(pool, "anon_daily_message_count"),
    ["anon_id", "message_count", "updated_at", "usage_date"]);
});

void test("a recorded cost rounds once at six decimal places", async () => {
  const rows = await pool.query<{ cost: string }>(INSERT_COST, [DAY, "anon", "0.12345678"]);
  assert.deepEqual(rows.rows, [{ cost: "0.123457" }]);
});

void test("every scope settlement writes is admitted", async () => {
  const written = await Promise.all(SCOPES.map((scope) => pool.query<{ cost: string }>(INSERT_COST, [DAY, scope, "1"])));
  assert.deepEqual(written.map((result) => result.rowCount), [1, 1, 1, 1]);
});

void test("a scope no payer produces is refused", async () => {
  await assert.rejects(pool.query(INSERT_COST, [DAY, "sponsor", "1"]), { code: "23514" });
});

void test("the anonymous meter accumulates on its own day-and-identity key", async () => {
  const upsert = `INSERT INTO anon_daily_message_count (usage_date, anon_id, message_count) VALUES ($1::date, 'visitor', 1)
    ON CONFLICT (usage_date, anon_id) DO UPDATE SET message_count = anon_daily_message_count.message_count + 1
    RETURNING message_count::integer AS count`;
  await pool.query(upsert, [DAY]);
  const second = await pool.query<{ count: number }>(upsert, [DAY]);
  assert.deepEqual(second.rows, [{ count: 2 }]);
});

void test("the agent service may accumulate a usage day but never remove one", async () => {
  assert.deepEqual(await explicitAgentGrants(pool, "daily_usage"), ["INSERT", "SELECT", "UPDATE"]);
  assert.deepEqual(await explicitAgentGrants(pool, "anon_daily_message_count"), ["DELETE", "INSERT", "SELECT", "UPDATE"]);
});
