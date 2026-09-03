/**
 * W1-4 (#1253) lane contract: the staging catalog lane cannot hang.
 *
 * `api-test/` talks to a real deployed origin, so it never runs in CI and this
 * suite cannot execute it — what it CAN do is read the lane verbatim, the way
 * `agent-db-lane.test.ts` reads its own wiring. The invariant worth pinning is
 * the one an operator discovers the hard way: every request in that lane
 * carries the one shared deadline, so an origin that accepts a connection and
 * then says nothing fails the lane instead of hanging it.
 *
 * test-type: unit (reads a checked-in file; no network, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

const LANE = readFileSync(fileURLToPath(new URL("../api-test/catalog-api.test.ts", import.meta.url)), "utf8");

/** How many times the lane's source matches `pattern`. */
function occurrences(pattern: RegExp): number {
  return [...LANE.matchAll(pattern)].length;
}

void test("the staging lane's deadline is an abort deadline, not a comment", () => {
  assert.match(LANE, /const laneDeadline = AbortSignal\.timeout\(LANE_DEADLINE_MS\);/);
});

void test("every request the staging lane makes carries that one deadline", () => {
  assert.equal(occurrences(/\bfetch\(/g), 2);
  assert.equal(occurrences(/signal: laneDeadline/g), 2);
});
