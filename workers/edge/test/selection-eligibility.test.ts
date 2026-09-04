/**
 * What a deterministic selection does NOT need (review of #1296).
 *
 * Both refusals `DurableTurn` makes before it drives a turn are about reaching
 * a PROVIDER: a deployment that resolved no model, and a caller-keyed run whose
 * credential died with the incarnation that held it (#1289). A selection
 * reaches no provider, so both would fail it for a resource it never uses.
 *
 * The last case is the control: it is the same shape with no selection on it,
 * and it must still fail, or the exemption has quietly become a hole in #1289's
 * "no server-key fallback".
 *
 * test-type: unit (fake clock; no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { LUCKY_STAR_ROUTE } from "./doubles/catalog-payloads.ts";
import { SELECTION_RUN_ID, makeSelectionTurn } from "./doubles/make-selection-turn.ts";

const POINT_PICK = { of: "points", pointIds: ["spot-1"], origin: null, locale: "ja" } as const;
const SCRIPT = { itinerary: LUCKY_STAR_ROUTE };

void test("a deployment with a catalog and no provider key still answers a pick", async () => {
  const harness = makeSelectionTurn({ selection: POINT_PICK, script: SCRIPT, model: null });
  assert.deepEqual(await harness.turn.run(SELECTION_RUN_ID), { phase: "succeeded" });
  assert.deepEqual(harness.catalog.planned, [["spot-1"]]);
});

void test("that turn answers plan_selected rather than settling provider_failed", async () => {
  const harness = makeSelectionTurn({ selection: POINT_PICK, script: SCRIPT, model: null });
  await harness.turn.run(SELECTION_RUN_ID);
  assert.deepEqual(harness.store.failed, []);
  assert.equal(harness.store.succeeded.length, 1);
});

void test("a caller-keyed pick revived without its credential is still answered", async () => {
  const seed = { selection: POINT_PICK, script: SCRIPT, callerKeyed: true };
  const harness = makeSelectionTurn(seed);
  assert.deepEqual(await harness.turn.run(SELECTION_RUN_ID), { phase: "succeeded" });
  assert.deepEqual(harness.store.failed, []);
});

void test("a caller-keyed pick revived with neither key nor model is still answered", async () => {
  const seed = { selection: POINT_PICK, script: SCRIPT, callerKeyed: true, model: null };
  const harness = makeSelectionTurn(seed);
  assert.deepEqual(await harness.turn.run(SELECTION_RUN_ID), { phase: "succeeded" });
});

void test("a caller-keyed run that is NOT a selection still refuses the server's key", async () => {
  const harness = makeSelectionTurn({ selection: null, script: SCRIPT, callerKeyed: true });
  assert.deepEqual(await harness.turn.run(SELECTION_RUN_ID), { phase: "failed", reason: "provider_failed" });
  assert.deepEqual(harness.store.failed, ["provider_failed"]);
});

void test("a modelless run that is NOT a selection settles provider_failed", async () => {
  const harness = makeSelectionTurn({ selection: null, script: SCRIPT, model: null });
  assert.deepEqual(await harness.turn.run(SELECTION_RUN_ID), { phase: "failed", reason: "provider_failed" });
  assert.deepEqual(harness.store.failed, ["provider_failed"]);
});
