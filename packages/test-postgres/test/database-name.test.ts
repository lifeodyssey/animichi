/**
 * The per-call database name (#1663).
 *
 * The container is shared, so the DATABASE is the isolation unit: two calls —
 * in one run, or in two runs against the same container — must never land on
 * the same name. A killed run leaves its databases behind, so a fixed name is
 * not merely shared, it is what fails the run after it.
 *
 * This is the unit half of AC3; the container itself is the integration half
 * (`test/integration/shared-container.test.ts`).
 *
 * test-type: unit (imports one pure function; no Docker, no clock).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { uniqueDatabaseName } from "../src/database-name.ts";

const SUITE = "native_delivery";

void test("two calls with the same suite name get different database names (AC3)", () => {
  assert.notEqual(uniqueDatabaseName(SUITE), uniqueDatabaseName(SUITE));
});

void test("the suite name stays the prefix a lane can recognise its database by", () => {
  assert.ok(uniqueDatabaseName(SUITE).startsWith(`${SUITE}_`));
});

void test("a hundred calls are a hundred names", () => {
  const names = new Set(Array.from({ length: 100 }, () => uniqueDatabaseName(SUITE)));
  assert.equal(names.size, 100);
});

void test("a name stays inside PostgreSQL's 63-byte identifier ceiling", () => {
  assert.ok(Buffer.byteLength(uniqueDatabaseName("p".repeat(120))) <= 63);
});

/** Truncation is the trap: cutting the suffix away makes every call collide. */
void test("an over-long suite name still yields different names per call", () => {
  const overLong = "p".repeat(120);
  assert.notEqual(uniqueDatabaseName(overLong), uniqueDatabaseName(overLong));
});
