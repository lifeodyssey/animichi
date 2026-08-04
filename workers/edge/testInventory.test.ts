import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EDGE_DIR = fileURLToPath(new URL(".", import.meta.url));
const testFiles = readdirSync(EDGE_DIR).filter((name) => name.endsWith(".test.ts"));
const THIS_FILE = "testInventory.test.ts";

// Floor: 27 .test.ts files existed when the test:worker script switched from
// an explicit list to `node --test "workers/edge/*.test.ts"` (#558). Bump this
// floor when files are legitimately removed; never lower it to silence a miss.
const MIN_TEST_FILES = 27;

void test("testInventory: the worker test directory holds at least the pinned floor of test files", () => {
  assert.equal(
    testFiles.length >= MIN_TEST_FILES,
    true,
    `expected >= ${MIN_TEST_FILES} test files in workers/edge/, found ${testFiles.length} — ` +
      `bump MIN_TEST_FILES only when files are legitimately removed`,
  );
});

void test("testInventory: this file is part of the listing the glob reaches (self-check)", () => {
  assert.equal(testFiles.includes(THIS_FILE), true);
});
