/**
 * W2-2 (#1288) against real PostgreSQL: a deterministic selection's step under
 * the `(run_id, step_index)` contract (spec §三).
 *
 * Only a database can answer this one. The selection is carried to the alarm in
 * the user message's `response_data` — written by the intake's own transaction
 * — so what is under test is whether the run and the selection that defines it
 * really commit together and really come back out of the join `loadRunningTurn`
 * makes. And the replay turns on `(run_id, step_index)` being a primary key,
 * which is the schema's promise rather than this code's.
 *
 * The catalog counts its own calls, so "the step was replayed" is measured as
 * "the route was not planned again".
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { NeonTurnStore } from "../src/agent/session/neon-turn-store.ts";
import { SessionEnvelope } from "../src/agent/session/session-envelope.ts";
import { TurnAnswering } from "../src/agent/session/turn-answer.ts";
import { TurnCatalogSession } from "../src/agent/session/turn-catalog-session.ts";
import { EMPTY_TOOLBOX } from "../src/agent/session/turn-toolbox.ts";
import { NeonTurnRecords } from "../src/agent/intake/neon-turn-records.ts";
import { answerSelection } from "../src/agent/selection/turn-selection.ts";
import type { SelectionRequest } from "../src/agent/selection/selection-request.ts";
import { LUCKY_STAR_ROUTE, WASHINOMIYA } from "../test/doubles/catalog-payloads.ts";
import { CountingSelectionCatalog } from "../test/doubles/make-selection-turn.ts";
import { makeScriptedTurnModel } from "../test/doubles/make-turn-parts.ts";
import { makeSubmission, onlyRow, seedSession } from "./agent-rows.ts";
import { SETUP_HOOK_TIMEOUT_MS, startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";

const OWNER = "do-incarnation-2";
const PRICES = { inputUsdPerMtok: 0, outputUsdPerMtok: 0 };
const WORKS = [{ id: "1", title: "らき☆すた" }];
const PICK: SelectionRequest = { of: "candidates", candidateIds: ["1"], clarificationId: 1, locale: "ja" };
const LUCKY_STAR = { rows: [WASHINOMIYA], synced_at: "2026-09-01T00:00:00Z" };
const SCRIPT = { works: { "1": LUCKY_STAR }, itinerary: LUCKY_STAR_ROUTE };

let plane: AgentDataPlane;

before(async () => {
  plane = await startAgentDataPlane();
}, { timeout: SETUP_HOOK_TIMEOUT_MS });

after(async () => {
  await plane.stop();
});

/** One selection turn admitted through the production intake statements. */
async function admitSelectionTurn(sessionId: string): Promise<string> {
  await seedSession(plane.database, sessionId, "anon_0123456789abcdef0123456789abcdef");
  const submission = makeSubmission({ sessionId, text: "らき☆すた", selection: PICK });
  const opened = { submission, deadlineAt: new Date(Date.now() + 100_000), reservation: null };
  const receipt = await new NeonTurnRecords(plane.transactions).openTurn(opened);
  return receipt.runId;
}

/** The turn one alarm drives, over a session that already asked the question. */
function makeTurn(catalog: CountingSelectionCatalog): DurableTurn {
  const envelope = SessionEnvelope.empty.withClarification("anime_ambiguity", WORKS);
  const session = new TurnCatalogSession({ runId: "run-selection", locale: "ja", envelope });
  const emit = (): Promise<void> => Promise.resolve();
  return new DurableTurn({
    store: new NeonTurnStore(plane.transactions),
    model: makeScriptedTurnModel(),
    toolbox: EMPTY_TOOLBOX,
    answering: new TurnAnswering(session),
    memory: session,
    refs: session,
    selection: (request, steps) => answerSelection({ catalog, session, steps, emit }, request),
    systemPrompt: "test",
    prices: PRICES,
    emit,
    owner: OWNER,
    now: Date.now,
  });
}

async function stepRows(runId: string): Promise<unknown[]> {
  const rows = await plane.database.execute(
    sql`select step_index, tool_name, result is not null as settled
        from run_steps where run_id = ${runId} order by step_index`,
  );
  return rows.rows;
}

async function answeredIntent(sessionId: string): Promise<unknown> {
  const rows = await plane.database.execute(
    sql`select response_data ->> 'intent' as intent from messages
        where session_id = ${sessionId} and role = 'assistant' order by created_at desc limit 1`,
  );
  return onlyRow(rows).intent;
}

/** The crash injected as the database refusing the step INSERT — see
 * `turn-loop.db.test.ts`, which injects it the same way and says why. */
async function refuseStepWrites(): Promise<void> {
  await plane.database.execute(sql`create or replace function reject_run_step()
    returns trigger language plpgsql as $$ begin raise exception 'connection reset'; end; $$`);
  await plane.database.execute(sql`create trigger reject_run_steps before insert on run_steps
    for each row execute function reject_run_step()`);
}

async function allowStepWrites(): Promise<void> {
  await plane.database.execute(sql`drop trigger reject_run_steps on run_steps`);
}

void test("the intake commits the selection with the run, and the alarm reads it back", async () => {
  const runId = await admitSelectionTurn("session-w22");
  const catalog = new CountingSelectionCatalog(SCRIPT);
  assert.deepEqual(await makeTurn(catalog).run(runId), { phase: "succeeded" });
  assert.deepEqual(catalog.fetched, ["1"]);
  assert.deepEqual(await stepRows(runId), [{ step_index: 0, tool_name: "plan_multi", settled: true }]);
  assert.equal(await answeredIntent("session-w22"), "plan_multi");
});

void test("a crash between the route and the step write leaves the run for the retry", async () => {
  const runId = await admitSelectionTurn("session-w22-crash");
  const catalog = new CountingSelectionCatalog(SCRIPT);
  await refuseStepWrites();
  await assert.rejects(makeTurn(catalog).run(runId));
  await allowStepWrites();
  assert.deepEqual(await stepRows(runId), []);
  assert.equal(catalog.planned.length, 1);
});

void test("the retry settles the step and plans the route exactly once more", async () => {
  const runId = await admitSelectionTurn("session-w22-retry");
  const first = new CountingSelectionCatalog(SCRIPT);
  await refuseStepWrites();
  await assert.rejects(makeTurn(first).run(runId));
  await allowStepWrites();
  const retry = new CountingSelectionCatalog(SCRIPT);
  assert.deepEqual(await makeTurn(retry).run(runId), { phase: "succeeded" });
  assert.equal(retry.planned.length, 1);
  assert.deepEqual(await stepRows(runId), [{ step_index: 0, tool_name: "plan_multi", settled: true }]);
});

void test("an alarm that comes back to a settled step replays it, asking no catalog", async () => {
  const runId = await admitSelectionTurn("session-w22-replay");
  await makeTurn(new CountingSelectionCatalog(SCRIPT)).run(runId);
  await plane.database.execute(sql`update runs set status = 'running', finished_at = null where id = ${runId}`);
  const replay = new CountingSelectionCatalog(SCRIPT);
  assert.deepEqual(await makeTurn(replay).run(runId), { phase: "succeeded" });
  assert.deepEqual([replay.fetched, replay.planned], [[], []]);
  assert.deepEqual(await stepRows(runId), [{ step_index: 0, tool_name: "plan_multi", settled: true }]);
});
