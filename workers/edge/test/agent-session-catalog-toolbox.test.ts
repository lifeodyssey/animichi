/**
 * W1-4 (#1253): the catalog toolbox as the SESSION registers it.
 *
 * Both briefs deferred this wiring to whichever card landed second. The tools'
 * own suites prove each tool; this one proves the seam #1252 left behind — that
 * `session-turn.ts` builds a real `Toolbox` from `src/agent/tools/`, and that a
 * ref one step mints is still readable by the next step of the same run.
 *
 * The ref test is driven over the REAL pi loop and the real `TurnSteps`
 * persistence, not over two direct `execute` calls: "step N+1" only means
 * something if the steps were numbered and written down in between.
 *
 * test-type: unit (fake clock; no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { TurnCatalogSession } from "../src/agent/session/turn-catalog-session.ts";
import { turnToolbox } from "../src/agent/session/session-turn.ts";
import { LUCKY_STAR_ROUTE, SATTE, WASHINOMIYA } from "./doubles/catalog-payloads.ts";
import { InMemoryTurnStore } from "./doubles/in-memory-turn-store.ts";
import { makeScriptedTurnModel, makeSessionTurnParts, makeUserTranscript } from "./doubles/make-turn-parts.ts";
import { makeSequencedToolCallsStreamFn } from "./doubles/pi-provider-double.ts";

const NOW = 1_000;
const PRICES = { inputUsdPerMtok: 1, outputUsdPerMtok: 2 };

/** The ref `search_bangumi` mints for a two-row result, first mint of the run. */
const RUN_ID = "run-toolbox";
const FIRST_SEARCH_REF = `search:2:1@${RUN_ID}`;

/** A `CATALOG` binding that answers the two procedures this turn calls. */
function catalogBinding(): { fetch: (request: Request) => Promise<Response> } {
  const answers: Record<string, object> = {
    "/catalog/points-by-bangumi-id": { rows: [WASHINOMIYA, SATTE], synced_at: "2026-06-20T00:00:00.000Z" },
    "/catalog/itinerary": LUCKY_STAR_ROUTE,
  };
  return {
    fetch: (request) => {
      const body = answers[new URL(request.url).pathname];
      assert.ok(body, `the turn called an unscripted catalog procedure: ${request.url}`);
      return Promise.resolve(Response.json(body));
    },
  };
}

/** Run one real turn that calls `search_bangumi`, then routes what it found. */
async function runSearchThenRoute() {
  const store = new InMemoryTurnStore(
    { runId: "run-1", sessionId: "session-1", deadlineAt: NOW + 100_000, transcript: makeUserTranscript(), steps: [] },
    () => NOW,
  );
  const session = new TurnCatalogSession({ runId: RUN_ID, locale: "ja" });
  const model = makeScriptedTurnModel(
    makeSequencedToolCallsStreamFn([
      { name: "search_bangumi", arguments: { bangumi_id: "115908" } },
      { name: "plan_route", arguments: { search_result_ref: FIRST_SEARCH_REF } },
    ]),
  );
  const toolbox = turnToolbox({ CATALOG: catalogBinding() }, session, model);
  const turn = new DurableTurn({
    store, model, toolbox, ...makeSessionTurnParts(session), systemPrompt: "test", prices: PRICES,
    emit: () => Promise.resolve(), owner: "do-1", now: () => NOW,
  });
  await turn.run("run-1");
  return { store, session };
}

/** The details one settled step recorded, as the model and the ledger saw them. */
function stepDetails(store: InMemoryTurnStore, stepIndex: number): unknown {
  const step = store.steps.find((settled) => settled.stepIndex === stepIndex);
  assert.ok(step?.result, `no step ${String(stepIndex)} was persisted with a result`);
  return step.result.details;
}

void test("the session's toolbox lists all six tools in Python's order", () => {
  const session = new TurnCatalogSession({ runId: RUN_ID, locale: "ja" });
  const toolbox = turnToolbox({ CATALOG: catalogBinding() }, session, makeScriptedTurnModel());
  assert.deepEqual(toolbox.tools().map((tool) => tool.name), [
    "resolve_anime",
    "search_bangumi",
    "search_nearby",
    "plan_route",
    "web_search",
    "translate_anime_title",
  ]);
});

void test("an environment with no CATALOG binding leaves the turn without tools", () => {
  const session = new TurnCatalogSession({ runId: RUN_ID, locale: "ja" });
  assert.deepEqual(turnToolbox({}, session, makeScriptedTurnModel()).tools(), []);
});

void test("a ref minted in one step is readable by the next step of the same run", async () => {
  const { store } = await runSearchThenRoute();
  assert.deepEqual(stepDetails(store, 0), {
    outcome: "ok",
    result_ref: FIRST_SEARCH_REF,
    row_count: 2,
    anime_title: "らき☆すた",
    partial: false,
  });
  assert.deepEqual(stepDetails(store, 1), {
    status: "ok",
    itinerary_ref: `route:2:2@${RUN_ID}`,
    ordered_point_ids: ["spot-1", "spot-2"],
    point_count: 2,
    total_minutes: 120,
  });
});

void test("the rows behind the ref stay in the session, never in the step the model reads", async () => {
  const { session, store } = await runSearchThenRoute();
  assert.equal(session.searchResult(FIRST_SEARCH_REF)?.row_count, 2);
  assert.deepEqual(Object.keys(stepDetails(store, 0) as object).includes("rows"), false);
});
