/**
 * The two arms' budgets, and the proof that each arm still spends its own.
 *
 * #1326 merged two data-plane fixtures onto one recipe. The numbers were NOT
 * merged with them — the catalog spike keeps 30 x 1 s because it boots one
 * container for the whole suite, the edge agent-db lane keeps 60 x 1 s because
 * it boots one per file. Pinning the values here is only half of it: the other
 * half is that the edge arm derives its two exported deadlines from the budget
 * instead of re-writing the literals #1318 gave them.
 *
 * The suite set is enumerated from the directory, never pinned to a count: a
 * number here is a tripwire that fires in this package whenever another package
 * adds a lane (#1386, #1387), and it proves nothing the per-file assertions
 * below do not already prove.
 *
 * test-type: unit (reads checked-in files; no network, no clock).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { AGENT_DB_SETUP_BUDGET, hookTimeoutMs, SPIKE_SETUP_BUDGET } from "../src/setup-budget.ts";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), "utf8");

const AGENT_DB_DIR = "workers/edge/agent-db-test";
const AGENT_ARM = `${AGENT_DB_DIR}/postgres-arm.ts`;

function agentDbSuites(): string[] {
  return readdirSync(new URL(`${AGENT_DB_DIR}/`, ROOT))
    .filter((entry) => entry.endsWith(".db.test.ts"))
    .map((entry) => `${AGENT_DB_DIR}/${entry}`);
}

void test("the catalog spike keeps the budget #1324 measured it on", () => {
  assert.deepEqual(SPIKE_SETUP_BUDGET, {
    deadlineMs: 240_000,
    firstSession: { attemptCeiling: 30, pauseMs: 1_000 },
    chainMarginMs: 60_000,
  });
});

void test("the edge agent-db lane keeps the budget #1318 measured it on", () => {
  assert.deepEqual(AGENT_DB_SETUP_BUDGET, {
    deadlineMs: 240_000,
    firstSession: { attemptCeiling: 60, pauseMs: 1_000 },
    chainMarginMs: 60_000,
  });
});

/** #1318's two published numbers, unchanged by the move into this package. */
void test("the agent-db arm still publishes a 240s deadline inside a 300s hook", () => {
  assert.equal(AGENT_DB_SETUP_BUDGET.deadlineMs, 240_000);
  assert.equal(hookTimeoutMs(AGENT_DB_SETUP_BUDGET), 300_000);
});

void test("the agent-db arm derives both deadlines rather than writing them", () => {
  const arm = read(AGENT_ARM);
  assert.match(arm, /SETUP_DEADLINE_MS = AGENT_DB_SETUP_BUDGET\.deadlineMs/);
  assert.match(arm, /SETUP_HOOK_TIMEOUT_MS = hookTimeoutMs\(AGENT_DB_SETUP_BUDGET\)/);
  assert.doesNotMatch(arm, /= 240_000|= 300_000/);
});

void test("every agent-db suite takes its setup deadline from the arm", () => {
  const suites = agentDbSuites();
  assert.ok(suites.length > 0, `no *.db.test.ts found under ${AGENT_DB_DIR}`);
  for (const suite of suites) {
    assert.match(read(suite), /timeout: SETUP_HOOK_TIMEOUT_MS/, suite);
  }
});

/** The `before` hooks are the ones the deadline has to hold; a suite that
 * writes its own number there is back to the sum #1318 removed. */
void test("no agent-db suite writes its own setup deadline", () => {
  for (const suite of agentDbSuites()) {
    assert.doesNotMatch(read(suite), /timeout: 300_000/, suite);
  }
});
