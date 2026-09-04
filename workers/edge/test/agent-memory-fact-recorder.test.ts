/**
 * W2-4 (#1290): the facts one turn's settled steps put on the ledger.
 *
 * The recorder is what makes the ledger a record of what the session DID rather
 * than of what a model said: a pacing only becomes a hard constraint once
 * `plan_route` was actually called with it and actually planned. And because a
 * retried alarm replays every settled step, recording twice has to be the same
 * as recording once.
 *
 * test-type: unit (injected clock, no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { recordTurnFacts, type RecordedStep } from "../src/agent/memory/turn-fact-recorder.ts";
import { TurnCatalogSession } from "../src/agent/session/turn-catalog-session.ts";

const NOW = new Date("2026-09-02T00:00:00.000Z");

/** A `plan_route` step, with the pacing it was asked for and how it ended. */
function makeRouteStep(pacing: string, status = "ok"): RecordedStep {
  return {
    toolName: "plan_route",
    input: { search_result_ref: "search:2:1", pacing },
    details: { status, itinerary_ref: "route:2:2", point_count: 2, total_minutes: 120 },
  };
}

/**
 * A `plan_selected` step over the points a user ticked, in the shape #1288's
 * selection actually settles: a `SelectionRecord`, whose job is to carry enough
 * for a REPLAY to rebuild the answer, so the route sits under `itinerary`
 * rather than at the top of `details` the way Python's step payload did.
 * `test/selection-facts.test.ts` drives the real producer against the real
 * recorder, so this double cannot drift from it unnoticed.
 */
function makeSelectionStep(points: readonly unknown[]): RecordedStep {
  const itinerary = { ordered_points: points, source_ref: null };
  return { toolName: "plan_selected", input: { point_ids: [] }, details: { status: "ok", itinerary } };
}

function makeSession(): TurnCatalogSession {
  return new TurnCatalogSession({ locale: "ja" });
}

void test("a planned route records the pacing it was asked for", () => {
  const session = makeSession();
  recordTurnFacts(session, [makeRouteStep("chill")], NOW);
  assert.equal(session.memory.facts.activeHardConstraint()?.value, "chill");
});

void test("a route that never planned records no constraint", () => {
  const session = makeSession();
  recordTurnFacts(session, [makeRouteStep("chill", "upstream_unavailable")], NOW);
  assert.equal(session.memory.facts.isEmpty, true);
});

void test("a pacing outside the vocabulary records nothing", () => {
  const session = makeSession();
  recordTurnFacts(session, [makeRouteStep("sprint")], NOW);
  assert.equal(session.memory.facts.isEmpty, true);
});

void test("recording the same replayed steps twice is a no-op the second time", () => {
  const session = makeSession();
  const steps = [makeRouteStep("chill")];
  recordTurnFacts(session, steps, NOW);
  const first = session.memory.facts;
  recordTurnFacts(session, steps, NOW);
  assert.deepEqual(session.memory.facts.hardConstraints, first.hardConstraints);
});

void test("a later turn's different pacing supersedes the earlier one", () => {
  const session = makeSession();
  recordTurnFacts(session, [makeRouteStep("chill")], NOW);
  recordTurnFacts(session, [makeRouteStep("packed")], NOW);
  assert.equal(session.memory.facts.activeHardConstraint()?.value, "packed");
  assert.equal(session.memory.facts.hardConstraints.length, 2);
});

void test("a selected point with an episode becomes a scene reference", () => {
  const session = makeSession();
  recordTurnFacts(session, [makeSelectionStep([
    { id: "p1", episode: 3, name: "鷲宮神社", time_seconds: 92 },
  ])], NOW);
  assert.deepEqual(
    session.memory.facts.activeSceneReferences().map((record) => record.value),
    ["Episode 3 — 鷲宮神社 @ 92s"],
  );
});

void test("the catalog's no-episode sentinel is not a fact", () => {
  const session = makeSession();
  recordTurnFacts(session, [makeSelectionStep([{ id: "p1", episode: -1, name: "鷲宮神社" }])], NOW);
  assert.deepEqual(session.memory.facts.activeSceneReferences(), []);
});

void test("a step no fact can be read from records nothing", () => {
  const session = makeSession();
  recordTurnFacts(session, [{ toolName: "search_bangumi", input: {}, details: { outcome: "ok" } }], NOW);
  assert.equal(session.memory.facts.isEmpty, true);
});
