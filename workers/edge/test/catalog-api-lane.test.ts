/**
 * W1-4 (#1253) lane contract: the staging catalog lane cannot hang.
 *
 * `api-test/` talks to a real deployed origin, so it never runs in CI and this
 * suite cannot execute it — what it CAN do is read the lane verbatim. The
 * invariant worth pinning is the one an operator discovers the hard way: every
 * request in that lane carries the one shared deadline, so an origin that
 * accepts a connection and then says nothing fails the lane instead of
 * hanging it.
 *
 * test-type: unit (reads a checked-in file; no network, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

const LANE = readFileSync(fileURLToPath(new URL("../api-test/catalog-api.test.ts", import.meta.url)), "utf8");

/** The source of the call whose opening parenthesis sits at `open`. */
function callFrom(open: number): string {
  let depth = 0;
  for (let index = open; index < LANE.length; index += 1) {
    depth += Number(LANE[index] === "(") - Number(LANE[index] === ")");
    if (depth === 0) return LANE.slice(open, index + 1);
  }
  throw new Error("the staging lane has an unbalanced fetch call");
}

/** Every `laneFetch(...)` call in the lane, one call's own source each — the
 * lane reaches staging only through that door as of #1294. Counting
 * occurrences of the two patterns separately would not prove what this file
 * claims: one request could carry another signal while an unrelated object
 * supplied the missing mention. Each call is therefore read on its own. */
function fetchCalls(): string[] {
  return [...LANE.matchAll(/\blaneFetch\(/g)].map((match) => callFrom(match.index + match[0].length - 1));
}

void test("the staging lane's deadline is an abort deadline, not a comment", () => {
  assert.match(LANE, /const laneDeadline = AbortSignal\.timeout\(LANE_DEADLINE_MS\);/);
});

void test("every request the staging lane makes carries that one deadline", () => {
  const calls = fetchCalls();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.filter((call) => call.includes("signal: laneDeadline")), calls);
});
