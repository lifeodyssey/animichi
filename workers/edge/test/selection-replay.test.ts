/**
 * W2-2 (#1288): the `(run_id, step_index)` contract, on a selection's own step.
 *
 * Spec §三 names route persistence as the side effect the idempotency key
 * exists for, and a selection turn is nothing but that side effect. Both
 * branches of the crash are driven here: after the step row landed, the retry
 * must not ask the catalog again; before it landed, the run stays unsettled and
 * the retry is what completes it.
 *
 * test-type: unit (fake clock; no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TurnStoreUnavailable } from "../src/agent/session/run-machine.ts";
import type { ChatResponseDataPart } from "@animichi/contract";
import { LUCKY_STAR_ROUTE, SATTE, WASHINOMIYA } from "./doubles/catalog-payloads.ts";
import { SELECTION_RUN_ID, makeSelectionTurn } from "./doubles/make-selection-turn.ts";

const POINT_PICK = { of: "points", pointIds: ["spot-1", "spot-2"], origin: null, locale: "ja" } as const;
const WORK_PICK = { of: "candidates", candidateIds: ["1"], clarificationId: 1, locale: "ja" } as const;
const ASKED = { reason: "anime_ambiguity", candidates: [{ id: "1", title: "らき☆すた" }] };
const LUCKY_STAR = { rows: [WASHINOMIYA, SATTE], synced_at: "2026-09-01T00:00:00Z" };

/** The step an evicted attempt already settled, as `run_steps` holds it. */
function settledStep(toolName: string, details: unknown) {
  return {
    stepIndex: 0,
    toolName,
    input: {},
    result: { content: [{ type: "text" as const, text: "" }], details: details as never },
  };
}

function answeredPart(responseData: unknown): ChatResponseDataPart {
  return responseData as ChatResponseDataPart;
}

void test("a settled route step replays without asking the catalog a second time", async () => {
  const first = makeSelectionTurn({ selection: POINT_PICK, script: { itinerary: LUCKY_STAR_ROUTE } });
  await first.turn.run(SELECTION_RUN_ID);
  const steps = [settledStep("plan_selected", first.store.written[0]?.result.details)];
  const retry = makeSelectionTurn({ selection: POINT_PICK, script: { itinerary: LUCKY_STAR_ROUTE }, steps });
  assert.deepEqual(await retry.turn.run(SELECTION_RUN_ID), { phase: "succeeded" });
  assert.deepEqual(retry.catalog.planned, []);
});

void test("the replayed step answers the identical part the first attempt would have", async () => {
  const first = makeSelectionTurn({ selection: POINT_PICK, script: { itinerary: LUCKY_STAR_ROUTE } });
  await first.turn.run(SELECTION_RUN_ID);
  const steps = [settledStep("plan_selected", first.store.written[0]?.result.details)];
  const retry = makeSelectionTurn({ selection: POINT_PICK, script: {}, steps });
  await retry.turn.run(SELECTION_RUN_ID);
  const answered = answeredPart(retry.store.succeeded[0]?.responseData);
  assert.deepEqual(answered, answeredPart(first.store.succeeded[0]?.responseData));
});

void test("the replayed step stores the itinerary exactly once, from the record", async () => {
  const first = makeSelectionTurn({ selection: POINT_PICK, script: { itinerary: LUCKY_STAR_ROUTE } });
  await first.turn.run(SELECTION_RUN_ID);
  const steps = [settledStep("plan_selected", first.store.written[0]?.result.details)];
  const retry = makeSelectionTurn({ selection: POINT_PICK, script: {}, steps });
  await retry.turn.run(SELECTION_RUN_ID);
  assert.equal(retry.session.itineraries.size, 1);
});

void test("a step the store refused leaves the run unsettled for the alarm's retry", async () => {
  const harness = makeSelectionTurn({ selection: POINT_PICK, script: { itinerary: LUCKY_STAR_ROUTE } });
  harness.store.stepWritesFail = true;
  await assert.rejects(harness.turn.run(SELECTION_RUN_ID), TurnStoreUnavailable);
  assert.deepEqual([harness.store.succeeded, harness.store.failed], [[], []]);
});

void test("the retry after a refused step write executes it exactly once more", async () => {
  const harness = makeSelectionTurn({ selection: POINT_PICK, script: { itinerary: LUCKY_STAR_ROUTE } });
  harness.store.stepWritesFail = true;
  await assert.rejects(harness.turn.run(SELECTION_RUN_ID), TurnStoreUnavailable);
  harness.store.stepWritesFail = false;
  assert.deepEqual(await harness.turn.run(SELECTION_RUN_ID), { phase: "succeeded" });
  assert.equal(harness.catalog.planned.length, 2);
});

void test("a replayed work pick consumes the clarification once and leaves it consumed", async () => {
  const script = { works: { "1": LUCKY_STAR }, itinerary: LUCKY_STAR_ROUTE };
  const first = makeSelectionTurn({ selection: WORK_PICK, script, pending: ASKED });
  await first.turn.run(SELECTION_RUN_ID);
  assert.equal(first.session.envelope.pendingClarification, null);
  const steps = [settledStep("plan_multi", first.store.written[0]?.result.details)];
  const retry = makeSelectionTurn({ selection: WORK_PICK, script: {}, pending: ASKED, steps });
  await retry.turn.run(SELECTION_RUN_ID);
  assert.deepEqual([retry.session.envelope.pendingClarification, retry.catalog.fetched], [null, []]);
});

void test("the clarification id survives its own consumption, so a later question outranks it", async () => {
  const script = { works: { "1": LUCKY_STAR }, itinerary: LUCKY_STAR_ROUTE };
  const harness = makeSelectionTurn({ selection: WORK_PICK, script, pending: ASKED });
  await harness.turn.run(SELECTION_RUN_ID);
  assert.equal(harness.session.envelope.clarificationRevision, 1);
});
