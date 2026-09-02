import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

// W0-S1 (#1244): the measurement script's `format` command is what turns the
// recorded rows into the markdown table that gets pasted into the spec §四
// appendix, so the table shape is pinned here. Only `format` is exercised —
// every other command talks to the deployed Worker on purpose.
//
// test-type: unit (runs the checked-in script over fixture input; no network).

const SCRIPT = fileURLToPath(new URL("../../../scripts/spike/pi-s1-measure.sh", import.meta.url));

function formatRows(records: string): string {
  return execFileSync("bash", [SCRIPT, "format"], { input: records, encoding: "utf8" });
}

const HEADER = "| case | label | ms | status | detail |\n| --- | --- | --- | --- | --- |\n";

void test("the table carries a markdown header even with no rows", () => {
  assert.equal(formatRows(""), HEADER);
});

void test("each recorded row becomes one markdown row in order", () => {
  const records = "cold|cold wake-up|812|200|idle=900\nwarm|warm wake-up|58|200|idle=4\n";
  assert.equal(
    formatRows(records),
    `${HEADER}| cold | cold wake-up | 812 | 200 | idle=900 |\n| warm | warm wake-up | 58 | 200 | idle=4 |\n`,
  );
});

void test("blank and commented lines never reach the table", () => {
  const records = "\n# a note the operator left\nturn-mimo|round trip via mimo|4210|200|clean=yes\n";
  assert.equal(formatRows(records), `${HEADER}| turn-mimo | round trip via mimo | 4210 | 200 | clean=yes |\n`);
});

void test("a detail field keeps its spaces and equals signs intact", () => {
  const records = "abort-tool_call|abort at tool_call|1900|200|aborted=yes clean=yes\n";
  assert.ok(formatRows(records).includes("| aborted=yes clean=yes |"));
});
