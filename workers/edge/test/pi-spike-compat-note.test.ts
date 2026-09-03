import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MEASUREMENT,
  evidencePathsIn,
  runMatrix,
  type StubRun,
} from "./doubles/spike-compat-stub.ts";

// W0-S2 (#1245): what a recorded row does when the gateway is verbose.
//
// Every field of a row is cut to 160 characters, and the note field carries
// two things: what the gateway said, and `evidence=<path>` naming the response
// body the row was read from. A provider error is arbitrarily long and entirely
// outside our control, so cutting the two together lets the message push the
// path off the end — leaving a row that cannot point at its own evidence, which
// is the one part that is not recoverable from anywhere else.
//
// test-type: unit (the checked-in script over a loopback stub; no gateway).

const DIRECT_ONLY = { direct: true, zen: false };
const CASE_COUNT = 19;

/** Longer than the whole note budget, the way a provider stack trace is. */
const LONG_ERROR = `400 unsupported parameter: ${"strict".repeat(80)}`;

function evidencePathsOf(run: StubRun): string[] {
  return evidencePathsIn(readFileSync(join(run.out, "results.txt"), "utf8"));
}

function assertEveryRowNamesItsBody(run: StubRun): void {
  const paths = evidencePathsOf(run);
  assert.equal(paths.length, CASE_COUNT, "every case records a row");
  for (const path of paths) {
    assert.match(path, /^run-[^/]+\/\d{3}-.*\.json$/, `${path} was cut short`);
    assert.ok(existsSync(join(run.out, path)), `${path} does not resolve to a file`);
  }
}

void test("a long provider error never crowds out the evidence path", async () => {
  const run = await runMatrix({
    mimoRoutes: DIRECT_ONLY,
    response: { status: 200, body: { ...MEASUREMENT, error: LONG_ERROR } },
  });
  assertEveryRowNamesItsBody(run);
});

void test("a long failed-response body never crowds out the evidence path", async () => {
  const run = await runMatrix({
    mimoRoutes: DIRECT_ONLY,
    response: { status: 502, body: { error: LONG_ERROR } },
  });
  assertEveryRowNamesItsBody(run);
});

void test("the gateway's message is kept, just cut to what the suffix leaves", async () => {
  const run = await runMatrix({
    mimoRoutes: DIRECT_ONLY,
    response: { status: 200, body: { ...MEASUREMENT, error: LONG_ERROR } },
  });
  const results = readFileSync(join(run.out, "results.txt"), "utf8");
  assert.match(results, /400 unsupported parameter: strict/, "the message still starts the note");
  const notes = results.trim().split("\n").map((row) => row.split("|")[7] ?? "");
  for (const note of notes) assert.ok(note.length <= 160, `note of ${String(note.length)} chars`);
});

void test("a short message and its evidence both survive untouched", async () => {
  const run = await runMatrix({ mimoRoutes: DIRECT_ONLY });
  const results = readFileSync(join(run.out, "results.txt"), "utf8");
  assert.match(results, /events=2 evidence=run-/);
  assertEveryRowNamesItsBody(run);
});
