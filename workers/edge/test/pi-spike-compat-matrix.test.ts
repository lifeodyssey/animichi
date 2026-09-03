import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BOOLEAN_SWITCHES, MAX_TOKENS_FIELDS } from "../spike/pi/src/compat-switch.ts";
import {
  SCRIPT,
  evidencePathsIn,
  runMatrix,
  type StubRun,
} from "./doubles/spike-compat-stub.ts";

// W0-S2 (#1245): the measurement script is the deliverable the orchestrator
// runs against the real gateway, and a wrong matrix costs ~17 minutes per
// route before anyone notices. So the script is driven here against a stub
// that answers like the deployed Worker: the assertions are the exact request
// bodies it sends, the routes it skips, and the markdown table it prints.
//
// test-type: unit (the checked-in script over a loopback stub; no gateway).

function compatOf(body: string): unknown {
  return (JSON.parse(body) as { compat: unknown }).compat;
}

function expectedCompats(): unknown[] {
  const booleans = BOOLEAN_SWITCHES.flatMap((name) => [{ [name]: true }, { [name]: false }]);
  const fields = MAX_TOKENS_FIELDS.map((value) => ({ maxTokensField: value }));
  return [{}, ...booleans, ...fields];
}

function resultsOf(run: StubRun): string {
  return readFileSync(join(run.out, "results.txt"), "utf8");
}

const DIRECT_ONLY = { direct: true, zen: false };
const BOTH_ROUTES = { direct: true, zen: true };

void test("the matrix runs the defaults case plus both values of every switch", async () => {
  const run = await runMatrix({ mimoRoutes: DIRECT_ONLY });
  assert.deepEqual(run.compatBodies.map(compatOf), expectedCompats());
});

void test("every case names the route it was measured on", async () => {
  const run = await runMatrix({ mimoRoutes: DIRECT_ONLY });
  const routes = new Set(run.compatBodies.map((body) => (JSON.parse(body) as { route: string }).route));
  assert.deepEqual([...routes], ["direct"]);
});

void test("a route with no key is skipped with a reason, not a failure", async () => {
  const run = await runMatrix({ mimoRoutes: DIRECT_ONLY });
  assert.match(run.output, /\| zen \| - \| - \| skipped \| skipped \|/);
  assert.match(run.output, /no key for this route/);
});

void test("both routes are measured when both keys are present", async () => {
  const run = await runMatrix({ mimoRoutes: BOTH_ROUTES });
  assert.equal(run.compatBodies.length, expectedCompats().length * 2);
});

void test("readiness is read once, not once per case", async () => {
  const run = await runMatrix({ mimoRoutes: BOTH_ROUTES });
  assert.equal(run.healthzCount, 1);
});

void test("the printed table carries the header the spec table needs", async () => {
  const run = await runMatrix({ mimoRoutes: DIRECT_ONLY });
  assert.ok(
    run.output.includes(
      "| route | switch | value | tool round trip | streaming usage | wall ms | first token ms | note |",
    ),
  );
});

void test("a measured row carries the numbers the response reported", async () => {
  const run = await runMatrix({ mimoRoutes: DIRECT_ONLY });
  assert.match(run.output, /\| direct \| \(defaults\) \| auto \| yes \| yes \| 51902 \| 1204 \| events=2 /);
});

void test("every row names the response body it was read from", async () => {
  const run = await runMatrix({ mimoRoutes: DIRECT_ONLY });
  const paths = evidencePathsIn(resultsOf(run));
  assert.equal(paths.length, expectedCompats().length);
  assert.equal(new Set(paths).size, paths.length, "two rows must not share one file");
  for (const path of paths) assert.ok(existsSync(join(run.out, path)), `${path} is missing`);
});

// The bug this guards: a re-measured case used to overwrite the evidence
// behind the row already in results.txt, leaving two rows pointing at one file
// that only described the later run.
void test("re-measuring keeps the earlier run's evidence intact", async () => {
  const first = await runMatrix({ mimoRoutes: DIRECT_ONLY });
  const second = await runMatrix({ mimoRoutes: DIRECT_ONLY, out: first.out });
  const paths = evidencePathsIn(resultsOf(second));
  assert.equal(paths.length, expectedCompats().length * 2, "both runs are recorded");
  assert.equal(new Set(paths).size, paths.length, "no row's evidence was overwritten");
  for (const path of paths) assert.ok(existsSync(join(second.out, path)), `${path} is missing`);
});

function formatRows(records: string): string {
  return execFileSync("bash", [SCRIPT, "format"], { input: records, encoding: "utf8" });
}

void test("blank and commented lines never reach the table", () => {
  const records = "\n# a note the operator left\ndirect|supportsStore|false|yes|no|900|30|ok\n";
  assert.match(formatRows(records), /\| direct \| supportsStore \| false \| yes \| no \| 900 \| 30 \| ok \|/);
  assert.equal(formatRows(records).trim().split("\n").length, 3);
});

void test("a first token that never arrived is reported as none, not as zero", () => {
  const records = "direct|supportsStrictMode|true|no|no|1200|none|400 unsupported parameter\n";
  assert.match(formatRows(records), /\| none \| 400 unsupported parameter \|/);
});
