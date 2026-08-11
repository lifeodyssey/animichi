import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
const testFiles = readdirSync(TEST_DIR).filter((name) => name.endsWith(".test.ts"));

// Floor ratchet: 34 .test.ts files (including this one) after the 1-10-50
// splits added entry-container-env, entry-v1-routing, turnstile-siteverify,
// denied-egress (#1050) and AUTH-1 #945 added identity-policy-matrix. The
// floor RISES when new test files are added; it may only be lowered in the
// same PR that legitimately deletes a test file, with review.
const MIN_TEST_FILES = 34;

void test("test-inventory: the worker test directory holds at least the pinned floor of test files", () => {
  const found = testFiles.length;
  assert.equal(
    found >= MIN_TEST_FILES,
    true,
    `expected >= ${String(MIN_TEST_FILES)} test files in workers/edge/test/, found ${String(found)} — ` +
      "bump MIN_TEST_FILES only when files are legitimately removed",
  );
});

void test("test-inventory: the edge test script targets this directory via the glob", () => {
  const edgePkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.equal(String(edgePkg.scripts.test).includes("test/*.test.ts"), true);
});

void test("test-inventory: the root test:worker forwards to the edge package", () => {
  const rootPkg = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.equal(String(rootPkg.scripts["test:worker"]).includes("pnpm --filter edge-worker test"), true);
});
