/**
 * The counting control (part A's design, `README.md`, "Counting method"). One `pg` client in a fresh database of the
 * spike's own issues a known set of statements between a reset and a read, twice in a row with a reset between:
 * - three parameterised statements through the extended protocol (`SELECT $1::int`, an `INSERT`, an `UPDATE`): 3;
 * - one transaction, `BEGIN`, an `INSERT`, `COMMIT`: 3;
 * - one simple-protocol string of two statements, `SELECT 1; SELECT 2`, the shape of today's setup strings: 2;
 * - one named prepared statement executed twice: 2;
 * - one statement that fails, `SELECT 1/0`: 1 if `pg_stat_monitor` records failed statements.
 * The table is created and the client connected before the first reset, so only these statements fall inside a count.
 * Passes when both passes count exactly 11 (or both exactly 10, which would mean failed statements are not counted).
 * Then the database is dropped and read once more: today's host test drops its database before its runner can read,
 * so its rows must stay attributed by name after the drop.
 * Writes `../evidence/q2-count-control.json`; exits non-zero on a mismatch.
 */
import pg from "pg";
import { createDatabase, dropDatabase } from "./pg-admin.ts";
import { readCount, resetCounter } from "./counter.ts";
import { writeEvidence } from "../run/workerd.ts";

const DATABASE = "spike_pi_durable_control";

async function knownStatements(client: pg.Client, pass: number) {
  const base = pass * 10;
  await client.query("SELECT $1::int AS value", [base]);
  await client.query("INSERT INTO control_rows (id, note) VALUES ($1, $2)", [base + 1, "plain"]);
  await client.query("UPDATE control_rows SET note = $1 WHERE id = $2", ["updated", base + 1]);
  await client.query("BEGIN");
  await client.query("INSERT INTO control_rows (id, note) VALUES ($1, $2)", [base + 2, "in a transaction"]);
  await client.query("COMMIT");
  await client.query("SELECT 1; SELECT 2");
  for (const value of [base + 3, base + 4]) await client.query({ name: "spike_control_named", text: "SELECT $1::int + 1 AS next", values: [value] });
  const failed = await client.query("SELECT 1/0").then(() => null, (error: unknown) => (error instanceof Error ? error.message : String(error)));
  return { failed };
}

const dsn = await createDatabase(DATABASE);
const client = new pg.Client({ connectionString: dsn, application_name: "pi-durable-spike-control" });
const passes: { pass: number; failedStatementError: string | null; total: number; rows: unknown[] }[] = [];
try {
  await client.connect();
  await client.query("CREATE TABLE control_rows (id integer PRIMARY KEY, note text NOT NULL)");
  for (const pass of [1, 2]) {
    await resetCounter();
    const { failed } = await knownStatements(client, pass);
    const count = await readCount(DATABASE);
    passes.push({ pass, failedStatementError: failed, total: count.total, rows: count.rows });
  }
} finally {
  await client.end().catch(() => undefined);
  await dropDatabase(DATABASE);
}
const afterDrop = await readCount(DATABASE);

const totals = passes.map((pass) => pass.total);
const failedCounted = passes.every((pass) => (pass.rows as { elevel: number }[]).some((row) => row.elevel > 0));
const expected = failedCounted ? 11 : 10;
const pass = totals.every((total) => total === expected);
const survivesDrop = afterDrop.total === passes[1]?.total;
const verdict = { expected, failedStatementsCounted: failedCounted, totals, pass, afterDropTotal: afterDrop.total, rowsStayNamedAfterDrop: survivesDrop };
writeEvidence("q2-count-control.json", { database: DATABASE, method: "pg_stat_monitor 2.4, reset and read from spike_pi_durable_counter", verdict, passes, afterDrop });
console.log(`${pass ? "PASS" : "FAIL"} count control: expected ${String(expected)} twice, counted ${totals.join(" and ")}; failed statements counted: ${String(failedCounted)}`);
console.log(`${survivesDrop ? "PASS" : "FAIL"} after DROP DATABASE the second pass's ${String(passes[1]?.total)} statements still read by name: ${String(afterDrop.total)}`);
process.exitCode = pass && survivesDrop ? 0 : 1;
