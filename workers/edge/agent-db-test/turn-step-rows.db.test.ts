/**
 * #1397 against real PostgreSQL: every completed tool call of a turn publishes
 * a `run_steps` row on the transcript read.
 *
 * Only a database can answer it, because the row is lost inside a predicate. A
 * step's write renews the lease as its first statement, judged by the
 * DATABASE's `now()` — so "lapsed while this incarnation was still the only one
 * on the run" and "taken over by another" are states of the `runs` row against
 * the server's clock, and the store double moves in lockstep with the SQL, so
 * it could only restate either. The last three cases set them and count.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { sql, type SQL } from "drizzle-orm";
import { ANSWER_TOOL_NAME } from "@animichi/contract/agent-tool-schemas";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { NeonTurnStore } from "../src/agent/session/neon-turn-store.ts";
import type { TurnState } from "../src/agent/session/run-machine.ts";
import { readConversationOn } from "../src/agent/retrieval/neon-conversation-records.ts";
import { turnToolbox } from "../src/agent/session/session-turn.ts";
import { TurnCatalogSession } from "../src/agent/session/turn-catalog-session.ts";
import type { TurnFrame } from "../src/agent/session/turn-frames.ts";
import { makeScriptedTurnModel, makeSessionTurnParts } from "../test/doubles/make-turn-parts.ts";
import { KUKI_STATION, SATTE, WASHINOMIYA } from "../test/doubles/catalog-payloads.ts";
import {
  makeBatchedToolCallsStreamFn,
  type ScriptedToolCall,
} from "../test/doubles/pi-provider-double.ts";
import { seedRun, seedSession } from "./agent-rows.ts";
import { SETUP_HOOK_TIMEOUT_MS, startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";

const OWNER_ID = "neon-subject-steps";
const NEARBY: ScriptedToolCall = { name: "search_nearby", arguments: { location: "久喜駅" } };
const ANSWER: ScriptedToolCall = {
  name: ANSWER_TOOL_NAME,
  arguments: { kind: "search", message: "久喜駅の近くはこちらです。" },
};

let plane: AgentDataPlane;

before(async () => { plane = await startAgentDataPlane(); }, { timeout: SETUP_HOOK_TIMEOUT_MS });
after(() => plane.stop(), { timeout: 60_000 });

const NO_DELAY = (): Promise<void> => Promise.resolve();

/** A catalog that answers every procedure `search_nearby` walks through, and
 * lets a case say what the world does while the SECOND search is in flight —
 * where the defect lives: step 0 is written, step 1 is executing, and what
 * happened to the run row in between is what step 1's write must survive. */
function catalogBinding(betweenSearches: () => Promise<void>) {
  const answers: Record<string, object> = {
    "/catalog/geocode": { candidates: [KUKI_STATION] },
    "/catalog/nearby": { rows: [WASHINOMIYA, SATTE] },
  };
  let searches = 0;
  return {
    fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      const body = answers[path];
      assert.ok(body, `the turn called an unscripted catalog procedure: ${request.url}`);
      searches += path === "/catalog/nearby" ? 1 : 0;
      if (searches === 2) await betweenSearches();
      return Response.json(body);
    },
  };
}

/** One `runs` row edit, made while the second search is in flight. */
function runRow(runId: string, change: SQL): () => Promise<void> {
  return async () => {
    await plane.database.execute(sql`update runs set ${change} where id = ${runId}`);
  };
}

/** The run row as a turn whose last step outran one lease slice finds it: the
 * lease lapsed and NO other incarnation took it. Stated rather than waited for,
 * and ordinary rather than an incident — staging's gap between two settled
 * steps is 11 s at the median and 24 s at p90, against a 30 s slice. */
function lapseLease(runId: string): () => Promise<void> {
  return runRow(runId, sql`lease_expires_at = now() - interval '1 second'`);
}

/** The other half of the predicate: another incarnation TOOK the run over,
 * which is the one thing that must still refuse the write. */
function stealLease(runId: string): () => Promise<void> {
  return runRow(runId, sql`lease_owner = 'other-do',
    lease_expires_at = now() + interval '30 seconds'`);
}

/** The step indexes the read publishes for this run, asked again. */
async function publishedIndexes(sessionId: string, runId: string): Promise<number[]> {
  const page = await readConversationOn(plane.transactions, { sessionId, identityId: OWNER_ID });
  assert.ok(page);
  return (page.steps ?? []).filter((step) => step.run_id === runId).map((step) => step.step_index);
}

/** What one driven turn published, plus the second alarm the run may still get. */
interface DrivenTurn {
  readonly runId: string;
  readonly calls: number;
  readonly steps: readonly { readonly step_index: number; readonly params: string }[];
  /** The same turn woken again — the alarm is at-least-once. */
  readonly rerun: () => Promise<TurnState>;
}

/** Drive one turn over the real loop, then read its session back. */
async function driveTurn(
  sessionId: string,
  batches: readonly (readonly ScriptedToolCall[])[],
  betweenSearches: (runId: string) => () => Promise<void> = () => NO_DELAY,
  expected: TurnState = { phase: "succeeded" },
): Promise<DrivenTurn> {
  await seedSession(plane.database, sessionId, OWNER_ID);
  const runId = await seedRun(plane.database, { sessionId, status: "running", leaseExpiresAt: null });
  const frames: TurnFrame[] = [];
  const session = new TurnCatalogSession({ runId, locale: "ja" });
  const model = makeScriptedTurnModel(makeBatchedToolCallsStreamFn(batches));
  const turn = new DurableTurn({
    store: new NeonTurnStore(plane.transactions),
    model,
    toolbox: turnToolbox({ CATALOG: catalogBinding(betweenSearches(runId)) }, session, model),
    ...makeSessionTurnParts(session),
    systemPrompt: "test",
    prices: { inputUsdPerMtok: 0, outputUsdPerMtok: 0 },
    emit: (pushed) => {
      frames.push(...pushed);
      return Promise.resolve();
    },
    owner: "do-incarnation-steps",
    now: Date.now,
  });
  assert.deepEqual(await turn.run(runId), expected);
  const page = await readConversationOn(plane.transactions, { sessionId, identityId: OWNER_ID });
  assert.ok(page);
  const steps = (page.steps ?? []).filter((step) => step.run_id === runId);
  return {
    runId,
    calls: frames.filter((frame) => frame.type === "tool-input-available").length,
    steps: steps.map((step) => ({ step_index: step.step_index, params: step.params })),
    rerun: () => turn.run(runId),
  };
}

void test("two identical calls in one assistant message publish two steps", async () => {
  const driven = await driveTurn("session-1397-batched", [[NEARBY, NEARBY], [ANSWER]]);
  assert.equal(driven.calls, 2);
  assert.deepEqual(driven.steps.map((step) => step.step_index), [0, 1]);
});

void test("two identical calls in two assistant messages publish two steps", async () => {
  const driven = await driveTurn("session-1397-sequenced", [[NEARBY], [NEARBY], [ANSWER]]);
  assert.equal(driven.calls, 2);
  assert.deepEqual(driven.steps.map((step) => step.step_index), [0, 1]);
});

void test("the last call before the answer publishes its own step", async () => {
  const driven = await driveTurn("session-1397-last", [[NEARBY], [NEARBY, ANSWER]]);
  assert.equal(driven.calls, 2);
  assert.deepEqual(driven.steps.map((step) => step.step_index), [0, 1]);
});

void test("every published step carries the params its tool executed with", async () => {
  const driven = await driveTurn("session-1397-params", [[NEARBY], [NEARBY], [ANSWER]]);
  assert.equal(driven.steps.length, driven.calls);
  assert.deepEqual(driven.steps.map((step) => JSON.parse(step.params) as unknown), [
    { location: "久喜駅" },
    { location: "久喜駅" },
  ]);
});

/** The defect #1397 was opened for: a step slower than one lease slice was
 * dropped silently, because the renewal refused a lease that had merely lapsed
 * and `TurnSteps` reads that refusal as a takeover. */
void test("a step whose lease lapsed with nobody holding it still publishes", async () => {
  const driven = await driveTurn("session-1397-lapsed", [[NEARBY], [NEARBY], [ANSWER]], lapseLease);
  assert.equal(driven.steps.length, driven.calls);
  assert.deepEqual(driven.steps.map((step) => step.step_index), [0, 1]);
});

/** The harm measured rather than argued: the turn ends on its first pass, so
 * the at-least-once alarm re-derives nothing and adds no second copy. */
void test("a second alarm on the lapsed run adds no step", async () => {
  const driven = await driveTurn("session-1397-rearmed", [[NEARBY], [NEARBY], [ANSWER]], lapseLease);
  assert.deepEqual(await driven.rerun(), { phase: "already_settled" });
  assert.deepEqual(await publishedIndexes("session-1397-rearmed", driven.runId), [0, 1]);
});

/** The guard on the narrowed predicate: OURS-or-nobody's is not ANYBODY's. A
 * lease another incarnation took is a real takeover, so the write is refused,
 * the turn abandons, and only the first call's row survives. */
void test("a step whose lease another incarnation took writes nothing", async () => {
  const driven = await driveTurn(
    "session-1397-stolen", [[NEARBY], [NEARBY], [ANSWER]], stealLease, { phase: "abandoned" },
  );
  assert.deepEqual(driven.steps.map((step) => step.step_index), [0]);
});
