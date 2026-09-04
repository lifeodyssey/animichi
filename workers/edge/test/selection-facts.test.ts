/**
 * The seam between a deterministic selection (#1288) and the fact ledger
 * (#1290): a `plan_selected` pick is where Python's scene references came from.
 *
 * `turn-fact-recorder.ts` reads the step by its TOOL NAME and by the shape of
 * what it settled, and neither side imports the other — `memory/` sits below
 * `selection/` and must not depend upwards. This file is what holds the two
 * together: rename `SELECTED_ROUTE_STEP`, or move `ordered_points` inside the
 * settled record, and it goes red.
 *
 * test-type: unit (fake clock; no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { LUCKY_STAR_ROUTE } from "./doubles/catalog-payloads.ts";
import { SELECTION_RUN_ID, makeSelectionTurn } from "./doubles/make-selection-turn.ts";

const POINT_PICK = { of: "points", pointIds: ["spot-1", "spot-2"], origin: null, locale: "ja" } as const;
const WORK_PICK = { of: "candidates", candidateIds: ["1"], clarificationId: 1, locale: "ja" } as const;
const ASKED = { reason: "anime_ambiguity", candidates: [{ id: "1", title: "らき☆すた" }] };
const LUCKY_STAR = { rows: LUCKY_STAR_ROUTE.ordered_points, synced_at: "2026-09-01T00:00:00Z" };

/** The live scene references the turn left in the session's ledger. */
function scenesAfter(memory: { facts: { activeSceneReferences: () => readonly { value: string }[] } }) {
  return memory.facts.activeSceneReferences().map((record) => record.value);
}

void test("a plan_selected pick leaves a scene reference in the fact ledger", async () => {
  const harness = makeSelectionTurn({ selection: POINT_PICK, script: { itinerary: LUCKY_STAR_ROUTE } });
  assert.deepEqual(await harness.turn.run(SELECTION_RUN_ID), { phase: "succeeded" });
  assert.deepEqual(scenesAfter(harness.session.envelope.memory), [
    "Episode 3 — 鷲宮神社 @ 120s",
    "Episode 3 — 幸手権現堂 @ 120s",
  ]);
});

void test("a pick the catalog could not route leaves no scene reference", async () => {
  const harness = makeSelectionTurn({ selection: POINT_PICK, script: {} });
  await harness.turn.run(SELECTION_RUN_ID);
  assert.deepEqual(scenesAfter(harness.session.envelope.memory), []);
});

void test("a merged work pick records no scene reference, as Python recorded none", async () => {
  const script = { works: { "1": LUCKY_STAR }, itinerary: LUCKY_STAR_ROUTE };
  const harness = makeSelectionTurn({ selection: WORK_PICK, script, pending: ASKED });
  assert.deepEqual(await harness.turn.run(SELECTION_RUN_ID), { phase: "succeeded" });
  assert.deepEqual(scenesAfter(harness.session.envelope.memory), []);
});

void test("a replayed pick records the same scene references, not a second set", async () => {
  const first = makeSelectionTurn({ selection: POINT_PICK, script: { itinerary: LUCKY_STAR_ROUTE } });
  await first.turn.run(SELECTION_RUN_ID);
  const settled = first.store.written[0]?.result;
  const steps = [{ stepIndex: 0, toolName: "plan_selected", input: {}, result: settled ?? null }];
  const retry = makeSelectionTurn({ selection: POINT_PICK, script: {}, steps });
  await retry.turn.run(SELECTION_RUN_ID);
  assert.deepEqual(scenesAfter(retry.session.envelope.memory), scenesAfter(first.session.envelope.memory));
});
