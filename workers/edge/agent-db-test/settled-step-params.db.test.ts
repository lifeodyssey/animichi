/**
 * E-2 (#1381) against real PostgreSQL: the settled params a returning client
 * reads back, and the bound the pagination puts on them.
 *
 * Three claims here are about the DATABASE and not about the use case, so a
 * double cannot answer for any of them. The steps of two runs must come back
 * grouped by the run that numbered them, which is an ordering over a join the
 * store double does not perform. `run_steps.input` must survive as JSON text
 * with its types intact — a coerced `bangumi_id` is a number on the way out or
 * the second witness is a lie. And the page must not ship the steps of a run
 * whose calls it does not show, which is a predicate in the statement.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readConversationOn } from "../src/agent/retrieval/neon-conversation-records.ts";
import { SETUP_HOOK_TIMEOUT_MS, startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";
import { seedMessage, seedRun, seedSession, seedStep } from "./agent-rows.ts";

const OWNER = "neon-subject-1";

let plane: AgentDataPlane;

before(async () => { plane = await startAgentDataPlane(); }, { timeout: SETUP_HOOK_TIMEOUT_MS });
after(() => plane.stop(), { timeout: 60_000 });

function read(sessionId: string, page: { limit: number; offset: number } = { limit: 100, offset: 0 }) {
  return readConversationOn(plane.transactions, { sessionId, identityId: OWNER, ...page });
}

/**
 * One settled turn: the run, the step it settled, and the assistant tool-call
 * row that names the run (#1386) — the row that puts this turn's calls on a
 * page, and therefore its steps in the read's scope.
 */
async function seedSettledTurn(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>,
  createdAt: string,
): Promise<string> {
  const runId = await seedRun(plane.database, { sessionId, status: "succeeded", leaseExpiresAt: null });
  await seedStep(plane.database, { runId, stepIndex: 0, toolName, input });
  await seedMessage(plane.database, {
    sessionId,
    role: "assistant",
    content: "",
    createdAt,
    responseData: { run_id: runId, step_index: 0, message: { role: "assistant" } },
  });
  return runId;
}

/** Two turns of one session, oldest first. The second ran with a coerced
 * `bangumi_id` — a number where the model sent a string. */
async function seedTwoSettledTurns(sessionId: string): Promise<string[]> {
  await seedSession(plane.database, sessionId, OWNER);
  const first = await seedSettledTurn(sessionId, "resolve_anime", { title: "ハルヒ" }, "2026-08-01T10:00:00Z");
  const second = await seedSettledTurn(sessionId, "search_bangumi", { bangumi_id: 12345 }, "2026-08-01T11:00:00Z");
  return [first, second];
}

void test("every run the page shows publishes its settled steps, each under its own run", async () => {
  const sessionId = "steps-per-run";
  const [first, second] = await seedTwoSettledTurns(sessionId);
  const page = await read(sessionId);
  assert.ok(page);
  assert.deepEqual(page.steps?.map((step) => [step.run_id, step.step_index, step.tool_name]), [
    [first, 0, "resolve_anime"],
    [second, 0, "search_bangumi"],
  ]);
});

void test("the published params are the JSON the tool executed with", async () => {
  const sessionId = "steps-params";
  await seedTwoSettledTurns(sessionId);
  const page = await read(sessionId);
  assert.ok(page);
  const params = page.steps?.map((step) => JSON.parse(step.params) as unknown);
  assert.deepEqual(params, [{ title: "ハルヒ" }, { bangumi_id: 12345 }]);
});

/** The bound: `run_steps` has no page of its own, so a page that shows none of
 * the first turn's calls must not carry that run's steps. */
void test("a page that shows only the later turn's call leaves the earlier run's steps off", async () => {
  const sessionId = "steps-paged";
  const [, second] = await seedTwoSettledTurns(sessionId);
  const page = await read(sessionId, { limit: 1, offset: 1 });
  assert.ok(page);
  assert.deepEqual(page.messages.map((message) => message.created_at), ["2026-08-01T11:00:00+00:00"]);
  assert.deepEqual(page.steps?.map((step) => step.run_id), [second]);
});

void test("a session that settled no step at all publishes an empty list", async () => {
  const sessionId = "steps-none";
  await seedSession(plane.database, sessionId, OWNER);
  await seedRun(plane.database, { sessionId, status: "succeeded", leaseExpiresAt: null });
  const page = await read(sessionId);
  assert.ok(page);
  assert.deepEqual(page.steps, []);
});
