/**
 * #1397 against real PostgreSQL: every completed tool call of a turn publishes
 * a `run_steps` row on the transcript read.
 *
 * Only a database can answer this, because the row is lost inside a predicate.
 * A step's write renews the run's lease as its first statement, and the
 * renewal is judged by the DATABASE's `now()` — so "the lease lapsed while this
 * incarnation was still the only one working on the run" is a state of the
 * `runs` row against the server's clock, not a flag a store double could be
 * asked to raise. The last case here sets exactly that state and then counts
 * what the real read publishes.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { ANSWER_TOOL_NAME } from "@animichi/contract/agent-tool-schemas";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { NeonTurnStore } from "../src/agent/session/neon-turn-store.ts";
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

/**
 * A catalog that answers every procedure `search_nearby` walks through, and
 * lets a case say what the world does while the SECOND search is in flight.
 *
 * The hook fires there because that is where the defect lives: step 0 is
 * already written, step 1 is executing, and whatever happened to the run row in
 * between is what step 1's write has to survive.
 */
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

/**
 * The run row as a turn whose last step took longer than one lease slice finds
 * it: the lease has lapsed and NO other incarnation has taken it.
 *
 * Stated rather than waited for. On staging the median gap between two settled
 * steps is 11 s and the 90th percentile is 24 s against a 30 s slice, so this
 * is the ordinary end of the latency distribution and not an incident.
 */
function lapseLease(runId: string): () => Promise<void> {
  return async () => {
    await plane.database.execute(
      sql`update runs set lease_expires_at = now() - interval '1 second' where id = ${runId}`,
    );
  };
}

/** What one driven turn published: the SD-9 frames and the transcript read. */
interface DrivenTurn {
  readonly runId: string;
  readonly calls: number;
  readonly steps: readonly { readonly step_index: number; readonly params: string }[];
}

/** Drive one turn over the real loop, then read its session back. */
async function driveTurn(
  sessionId: string,
  batches: readonly (readonly ScriptedToolCall[])[],
  betweenSearches: (runId: string) => () => Promise<void> = () => NO_DELAY,
): Promise<DrivenTurn> {
  await seedSession(plane.database, sessionId, OWNER_ID);
  const runId = await seedRun(plane.database, { sessionId, status: "running", leaseExpiresAt: null });
  const frames: TurnFrame[] = [];
  const session = new TurnCatalogSession({ runId, locale: "ja" });
  const model = makeScriptedTurnModel(makeBatchedToolCallsStreamFn(batches));
  const state = await new DurableTurn({
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
  }).run(runId);
  assert.deepEqual(state, { phase: "succeeded" });
  const page = await readConversationOn(plane.transactions, { sessionId, identityId: OWNER_ID });
  assert.ok(page);
  const steps = (page.steps ?? []).filter((step) => step.run_id === runId);
  return {
    runId,
    calls: frames.filter((frame) => frame.type === "tool-input-available").length,
    steps: steps.map((step) => ({ step_index: step.step_index, params: step.params })),
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

/**
 * The defect #1397 was opened for: a step slower than one lease slice was
 * silently dropped, because the renewal refused a lease that had merely lapsed
 * — nobody else had taken it — and `TurnSteps` reads that refusal as a
 * takeover.
 */
void test("a step whose lease lapsed with nobody holding it still publishes", async () => {
  const driven = await driveTurn("session-1397-lapsed", [[NEARBY], [NEARBY], [ANSWER]], lapseLease);
  assert.equal(driven.steps.length, driven.calls);
  assert.deepEqual(driven.steps.map((step) => step.step_index), [0, 1]);
});
