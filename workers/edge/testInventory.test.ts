import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EDGE_DIR = fileURLToPath(new URL(".", import.meta.url));
const testFiles = readdirSync(EDGE_DIR).filter((name) => name.endsWith(".test.ts"));

// Floor ratchet: 28 .test.ts files (including this one) when #558 switched the
// runner to a glob. The floor RISES when new test files are added; it may only
// be lowered in the same PR that legitimately deletes a test file, with review.
const MIN_TEST_FILES = 28;

void test("testInventory: the worker test directory holds at least the pinned floor of test files", () => {
  assert.equal(
    testFiles.length >= MIN_TEST_FILES,
    true,
    `expected >= ${MIN_TEST_FILES} test files in workers/edge/, found ${testFiles.length} — ` +
      `bump MIN_TEST_FILES only when files are legitimately removed`,
  );
});

void test("testInventory: the runner script targets this directory via the glob", () => {
  const rootPkg = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.equal(rootPkg.scripts["test:worker"].includes("workers/edge/*.test.ts"), true);
});
