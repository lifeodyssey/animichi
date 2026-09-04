/**
 * W1 follow-up (#1279): the tool session, rebuilt from the settled steps of its
 * own run.
 *
 * `TurnSteps` answers a settled `(run_id, step_index)` from `run_steps.result`
 * without calling `execute`, so a ref minted before a crash is in no map
 * afterwards and the `plan_route` that names it reads back `stale_ref`. The
 * closing is two halves and both are measured here: the settled result CARRIES
 * the payload behind the ref, and the retry puts every one of them back — under
 * the same ref, in `step_index` order, with the mint sequence continued so a new
 * ref cannot collide with a replayed one.
 *
 * The crash/retry pair is driven over the REAL pi loop, the real step
 * persistence and the real catalog tools; only the provider socket and the
 * `CATALOG` binding are scripted.
 *
 * test-type: unit (fake clock; no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isJsonRecord } from "../src/agent/json-record.ts";
import { TurnStoreUnavailable } from "../src/agent/session/run-machine.ts";
import { rehydrateRefs, type StepMint } from "../src/agent/session/minted-refs.ts";
import { TurnCatalogSession } from "../src/agent/session/turn-catalog-session.ts";
import type { PersistedStep, SettledStep } from "../src/agent/session/turn-store.ts";
import {
  buildItineraryPayload,
  buildSearchResultPayload,
} from "../src/agent/tools/search-result-payload.ts";
import { LUCKY_STAR_ROUTE, SATTE, WASHINOMIYA } from "./doubles/catalog-payloads.ts";
import { makeEnvelopeTurnStore, runEnvelopeTurn } from "./doubles/make-envelope-turn.ts";
import type { InMemoryTurnStore } from "./doubles/in-memory-turn-store.ts";
import { makeSequencedToolCallsStreamFn } from "./doubles/pi-provider-double.ts";
import { RecordingEnvelopeStorage } from "./doubles/recording-envelope-storage.ts";

const SEARCH_REF = "search:2:1";
const SEARCH_CALL = { name: "search_bangumi", arguments: { bangumi_id: "1" } };
const PLAN_CALL = { name: "plan_route", arguments: { search_result_ref: SEARCH_REF } };

const WORK_ROWS = buildSearchResultPayload([WASHINOMIYA, SATTE], "bangumi", "1", false, "ja");
const NEARBY_ROWS = buildSearchResultPayload([WASHINOMIYA], "nearby", null, false, "ja");
const ROUTE = buildItineraryPayload(LUCKY_STAR_ROUTE, SEARCH_REF, "ja");

const WORK_MINT: StepMint = { kind: "search", ref: SEARCH_REF, payload: WORK_ROWS };
const NEARBY_MINT: StepMint = { kind: "search", ref: "search:1:2", payload: NEARBY_ROWS };

/** One settled step, as `run_steps` holds it once the mints ride along. */
function settledStep(stepIndex: number, minted: StepMint[]): PersistedStep {
  return {
    stepIndex,
    toolName: "search_bangumi",
    input: {},
    result: { content: [{ type: "text", text: "" }], details: null, minted },
  };
}

function turnSession(): TurnCatalogSession {
  return new TurnCatalogSession({ locale: "ja" });
}

void test("a settled step's ref comes back with the rows behind it", () => {
  const session = turnSession();
  rehydrateRefs(session, [settledStep(0, [WORK_MINT])]);
  assert.deepEqual(session.searchResult(SEARCH_REF), WORK_ROWS);
});

void test("the mint sequence continues past the settled steps, so nothing collides", () => {
  const session = turnSession();
  rehydrateRefs(session, [settledStep(0, [WORK_MINT])]);
  assert.equal(session.storeItinerary(ROUTE), "route:2:2");
});

void test("the refs come back in step_index order, whatever order the rows arrive in", () => {
  const session = turnSession();
  rehydrateRefs(session, [settledStep(1, [NEARBY_MINT]), settledStep(0, [WORK_MINT])]);
  assert.deepEqual([...session.searchResults.keys()], [SEARCH_REF, "search:1:2"]);
});

void test("the sequence continues past every settled step, not just the first", () => {
  const session = turnSession();
  rehydrateRefs(session, [settledStep(1, [NEARBY_MINT]), settledStep(0, [WORK_MINT])]);
  assert.equal(session.storeItinerary(ROUTE), "route:2:3");
});

void test("a step settled before the mints were recorded puts nothing back", () => {
  const session = turnSession();
  const bare = { content: [{ type: "text" as const, text: "" }], details: null };
  rehydrateRefs(session, [{ stepIndex: 0, toolName: "search_bangumi", input: {}, result: bare }]);
  assert.deepEqual([...session.searchResults.keys()], []);
  assert.equal(session.storeSearchResult(WORK_ROWS), SEARCH_REF);
});

void test("a step that never settled puts nothing back", () => {
  const session = turnSession();
  rehydrateRefs(session, [{ stepIndex: 0, toolName: "search_bangumi", input: {}, result: null }]);
  assert.deepEqual([...session.searchResults.keys()], []);
});

/** The status a settled step reported, as `run_steps.result` holds it. */
function settledStatus(step: SettledStep | undefined): unknown {
  const details = step?.result.details;
  return isJsonRecord(details) ? details.status : null;
}

/** The ref a settled route step handed the model. */
function settledRouteRef(step: SettledStep | undefined): unknown {
  const details = step?.result.details;
  return isJsonRecord(details) ? details.itinerary_ref : null;
}

/**
 * The attempt that settled `search_bangumi` and crashed before the route
 * landed: the store refuses step 1, which leaves step 0 and the assistant
 * message that opened it in place and the run still `running`.
 */
async function crashedAfterSearch(storage: RecordingEnvelopeStorage): Promise<InMemoryTurnStore> {
  const store = makeEnvelopeTurnStore();
  store.refuseStepsFrom = 1;
  const streamFn = makeSequencedToolCallsStreamFn([SEARCH_CALL, PLAN_CALL]);
  await assert.rejects(runEnvelopeTurn({ storage, store, streamFn }), TurnStoreUnavailable);
  store.refuseStepsFrom = Number.POSITIVE_INFINITY;
  return store;
}

void test("the settled search step carries the rows its ref names", async () => {
  const store = await crashedAfterSearch(new RecordingEnvelopeStorage());
  assert.deepEqual(store.written.map((step) => step.stepIndex), [0]);
  assert.deepEqual(store.written[0]?.result.minted, [WORK_MINT]);
});

void test("the retry plans the route over the ref the crashed attempt minted", async () => {
  const storage = new RecordingEnvelopeStorage();
  const store = await crashedAfterSearch(storage);
  const streamFn = makeSequencedToolCallsStreamFn([PLAN_CALL]);
  const retry = await runEnvelopeTurn({ storage, store, streamFn });
  assert.deepEqual(retry.state, { phase: "succeeded" });
  assert.deepEqual(store.written.map((step) => [step.stepIndex, step.toolName]), [
    [0, "search_bangumi"],
    [1, "plan_route"],
  ]);
  assert.equal(settledStatus(store.written[1]), "ok");
});

void test("the route the retry planned is minted under a ref of its own", async () => {
  const storage = new RecordingEnvelopeStorage();
  const store = await crashedAfterSearch(storage);
  await runEnvelopeTurn({ storage, store, streamFn: makeSequencedToolCallsStreamFn([PLAN_CALL]) });
  assert.equal(settledRouteRef(store.written[1]), "route:2:2");
});
