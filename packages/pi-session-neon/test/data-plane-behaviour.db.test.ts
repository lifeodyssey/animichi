// The data-plane behaviours #1627 pins on the database the chain builds: `points` scalars
// derived from `location`, and the shared updated-at trigger on every table it maintains.
// The catalogue shape behind these behaviours is proved in migration-target.db.test.ts.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { pool } from "./postgres.ts";

const ROW = "data-plane-behaviour";
const PAST = "2001-02-03T04:05:06Z";
const KYOTO = "ST_SetSRID(ST_MakePoint(135.7681, 35.0116), 4326)::geography";
const TOKYO = "ST_SetSRID(ST_MakePoint(139.7454, 35.6586), 4326)::geography";

/** Every table the chain maintains an updated-at trigger on, with the trigger it carries. */
const MAINTAINED_TABLES = [
  { tableName: "bangumi", triggerName: "trg_bangumi_updated_at" },
  { tableName: "points", triggerName: "trg_points_updated_at" },
  { tableName: "saved_routes", triggerName: "trg_routes_updated_at" },
  { tableName: "sessions", triggerName: "trg_sessions_updated_at" },
] as const;

afterEach(async () => {
  await pool.query("DELETE FROM points WHERE id = $1", [ROW]);
  await pool.query("DELETE FROM bangumi WHERE id = $1", [ROW]);
  await pool.query("DELETE FROM saved_routes WHERE title = $1", [ROW]);
  await pool.query("DELETE FROM sessions WHERE id = $1", [ROW]);
});

/** One Kyoto point stamped with a known past, so an UPDATE has room to advance from. */
function insertKyotoPoint() {
  return pool.query(`INSERT INTO points (id, name, location, updated_at) VALUES ($1, 'Kyoto Tower', ${KYOTO}, $2)`, [ROW, PAST]);
}

void test("a point reads its scalars straight from the location it was written with", async () => {
  await insertKyotoPoint();
  const rows = await pool.query<{ derived: boolean }>(
    "SELECT latitude = 35.0116 AND longitude = 135.7681 AS derived FROM points WHERE id = $1", [ROW]);
  assert.deepEqual(rows.rows, [{ derived: true }]);
});

void test("moving a point's location moves the derived scalars with it", async () => {
  await insertKyotoPoint();
  await pool.query(`UPDATE points SET location = ${TOKYO} WHERE id = $1`, [ROW]);
  const rows = await pool.query<{ derived: boolean }>(
    "SELECT latitude = 35.6586 AND longitude = 139.7454 AS derived FROM points WHERE id = $1", [ROW]);
  assert.deepEqual(rows.rows, [{ derived: true }]);
});

void test("the updated-at trigger inventory is exactly the tables the chain maintains", async () => {
  const rows = await pool.query<{ tableName: string; triggerName: string }>(
    `SELECT target_table.relname AS "tableName", trigger_record.tgname AS "triggerName"
       FROM pg_trigger AS trigger_record
       JOIN pg_class AS target_table ON target_table.oid = trigger_record.tgrelid
       JOIN pg_namespace AS target_namespace ON target_namespace.oid = target_table.relnamespace
      WHERE target_namespace.nspname = 'public'
        AND trigger_record.tgname ~ '^trg_[a-z_]+_updated_at$'
        AND NOT trigger_record.tgisinternal
      ORDER BY "tableName"`);
  assert.deepEqual(rows.rows, MAINTAINED_TABLES);
});

void test("updating a bangumi row advances its updated_at through the shared trigger", async () => {
  await pool.query("INSERT INTO bangumi (id, title, updated_at) VALUES ($1, 'Animichi', $2)", [ROW, PAST]);
  await pool.query("UPDATE bangumi SET points_count = 1 WHERE id = $1", [ROW]);
  const rows = await pool.query<{ advanced: boolean }>(
    "SELECT updated_at > $2 AS advanced FROM bangumi WHERE id = $1", [ROW, PAST]);
  assert.deepEqual(rows.rows, [{ advanced: true }]);
});

void test("updating a point row advances its updated_at through the shared trigger", async () => {
  await insertKyotoPoint();
  await pool.query("UPDATE points SET scene_desc = 'named' WHERE id = $1", [ROW]);
  const rows = await pool.query<{ advanced: boolean }>(
    "SELECT updated_at > $2 AS advanced FROM points WHERE id = $1", [ROW, PAST]);
  assert.deepEqual(rows.rows, [{ advanced: true }]);
});

void test("updating a saved_routes row advances its updated_at through the shared trigger", async () => {
  await pool.query("INSERT INTO saved_routes (point_ids, title, updated_at) VALUES (ARRAY['kyoto'], $1, $2)", [ROW, PAST]);
  await pool.query("UPDATE saved_routes SET status = 'saved' WHERE title = $1", [ROW]);
  const rows = await pool.query<{ advanced: boolean }>(
    "SELECT updated_at > $2 AS advanced FROM saved_routes WHERE title = $1", [ROW, PAST]);
  assert.deepEqual(rows.rows, [{ advanced: true }]);
});

void test("updating a sessions row advances its updated_at through the shared trigger", async () => {
  await pool.query("INSERT INTO sessions (id, updated_at) VALUES ($1, $2)", [ROW, PAST]);
  await pool.query("UPDATE sessions SET title = 'named' WHERE id = $1", [ROW]);
  const rows = await pool.query<{ advanced: boolean }>(
    "SELECT updated_at > $2 AS advanced FROM sessions WHERE id = $1", [ROW, PAST]);
  assert.deepEqual(rows.rows, [{ advanced: true }]);
});
