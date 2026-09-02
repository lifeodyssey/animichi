import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

// W0-S4 (#1247): the measurement script's `format` command turns the recorded
// rows into the markdown table that goes into the spec §四 appendix, so the
// table shape is pinned here — and so is the script's refusal to run a case
// without a deployed Worker to run it against. Every other command talks to
// that deployment on purpose.
//
// test-type: unit (runs the checked-in script over fixture input; no network).

const SCRIPT = fileURLToPath(new URL("../../../scripts/spike/pi-s4-durable.sh", import.meta.url));

function formatRows(records: string): string {
  return execFileSync("bash", [SCRIPT, "format"], { input: records, encoding: "utf8" });
}

function runCommand(...args: string[]): void {
  execFileSync("bash", [SCRIPT, ...args], { encoding: "utf8", stdio: "pipe" });
}

const HEADER = "| case | label | ms | status | detail |\n| --- | --- | --- | --- | --- |\n";

void test("the table carries a markdown header even with no rows", () => {
  assert.equal(formatRows(""), HEADER);
});

void test("each recorded case becomes one markdown row in order", () => {
  const records = [
    "long-turn|5-minute turn, client hung up|301402|succeeded|steps=3 tools=3 billedMs=300118",
    "concurrent-turn|second turn on a running session|0|409|expected=409",
    "",
  ].join("\n");
  assert.equal(
    formatRows(records),
    `${HEADER}| long-turn | 5-minute turn, client hung up | 301402 | succeeded |` +
      ` steps=3 tools=3 billedMs=300118 |\n` +
      `| concurrent-turn | second turn on a running session | 0 | 409 | expected=409 |\n`,
  );
});

void test("blank and commented lines never reach the table", () => {
  const records = "\n# the operator's note\ncrash-replay|crash branch|0|succeeded|tools=4\n";
  assert.equal(formatRows(records), `${HEADER}| crash-replay | crash branch | 0 | succeeded | tools=4 |\n`);
});

void test("every case refuses to run without a deployed Worker to measure", () => {
  assert.throws(() => {
    runCommand("long");
  }, /Command failed/);
  assert.throws(() => {
    runCommand("busy");
  }, /Command failed/);
  assert.throws(() => {
    runCommand("crash");
  }, /Command failed/);
  assert.throws(() => {
    runCommand("all");
  }, /Command failed/);
});

void test("an unknown command prints the usage rather than guessing", () => {
  assert.throws(() => {
    runCommand("measure-everything", "--url", "https://spike.test");
  }, /Command failed/);
});
