/**
 * Source contracts for the migrated template (#1769): the seed holds the
 * cluster turn, the clone does not, and startTestPostgres clones per database.
 *
 * test-type: unit (reads checked-in files; no Docker, no clock).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PACKAGE_ROOT = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, PACKAGE_ROOT), "utf8");

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}`);
  assert.ok(start >= 0, `missing ${name}`);
  const next = source.indexOf("\nasync function ", start + 1);
  return next < 0 ? source.slice(start) : source.slice(start, next);
}

void test("the seed holds the cluster turn and the clone does not", () => {
  const source = read("src/migrated-template.ts");
  assert.match(functionBody(source, "seedMigratedTemplate"), /ChainApplyTurn/);
  assert.doesNotMatch(functionBody(source, "cloneFromTemplate"), /ChainApplyTurn|pg_advisory_lock/);
});

void test("startTestPostgres clones the migrated template instead of applying the chain", () => {
  const source = read("src/test-postgres.ts");
  assert.match(source, /createMigratedDatabase/);
  assert.doesNotMatch(source, /applyPrismaChain/);
  assert.doesNotMatch(source, /ChainApplyTurn/);
});
