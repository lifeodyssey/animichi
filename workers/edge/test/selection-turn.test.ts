/**
 * W2-2 (#1288): a deterministic selection driven as a whole alarm-hosted turn.
 *
 * The catalog counts its calls, so "the step replayed" is measured as "the
 * catalog was not asked again". The clock is fixed and nothing here touches a
 * socket or a database.
 *
 * test-type: unit (fake clock; no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { ChatResponseDataPart } from "@animichi/contract";
import { LUCKY_STAR_ROUTE, SATTE, UJI_BRIDGE, WASHINOMIYA } from "./doubles/catalog-payloads.ts";
import { SELECTION_RUN_ID, makeSelectionTurn } from "./doubles/make-selection-turn.ts";

const WORKS = [
  { id: "1", title: "らき☆すた" },
  { id: "2", title: "響け！ユーフォニアム" },
];
const LUCKY_STAR = { rows: [WASHINOMIYA, SATTE], synced_at: "2026-09-01T00:00:00Z" };
const EUPHONIUM = { rows: [UJI_BRIDGE], synced_at: "2026-09-01T00:00:00Z" };
const POINT_PICK = { of: "points", pointIds: ["spot-1", "spot-2"], origin: "35.0,135.0", locale: "ja" } as const;
const WORK_PICK = { of: "candidates", candidateIds: ["1", "2"], clarificationId: 1, locale: "ja" } as const;
const ASKED = { reason: "anime_ambiguity", candidates: WORKS };

/** The whole `data-response` part the settled turn committed. */
function answeredPart(responseData: unknown): ChatResponseDataPart {
  return responseData as ChatResponseDataPart;
}

/** The `RouteData` half of a part whose intent the case has already asserted —
 * the projection's own two members, read without re-narrowing the whole union. */
interface RouteWire {
  results?: { kind?: string };
  itinerary?: { point_count?: number };
}

function routeData(responseData: unknown): RouteWire {
  return (responseData as { data?: RouteWire }).data ?? {};
}

void test("a point pick routes what was ticked and answers plan_selected", async () => {
  const harness = makeSelectionTurn({ selection: POINT_PICK, script: { itinerary: LUCKY_STAR_ROUTE } });
  assert.deepEqual(await harness.turn.run(SELECTION_RUN_ID), { phase: "succeeded" });
  assert.deepEqual(harness.catalog.planned, [["spot-1", "spot-2"]]);
  const part = answeredPart(harness.store.succeeded[0]?.responseData);
  assert.equal(part.intent, "plan_selected");
  assert.deepEqual([part.success, part.status], [true, "ok"]);
  assert.equal(part.message, "2件の選択スポットでルートを作成しました。");
});

void test("a point pick never reaches a model, so the turn meters no provider request", async () => {
  const harness = makeSelectionTurn({ selection: POINT_PICK, script: { itinerary: LUCKY_STAR_ROUTE } });
  await harness.turn.run(SELECTION_RUN_ID);
  assert.equal(harness.store.succeeded[0]?.usage.requests, 0);
});

void test("a point pick the catalog cannot route answers Python's own failure text", async () => {
  const harness = makeSelectionTurn({ selection: POINT_PICK, script: {} });
  assert.deepEqual(await harness.turn.run(SELECTION_RUN_ID), { phase: "succeeded" });
  const part = answeredPart(harness.store.succeeded[0]?.responseData);
  assert.deepEqual([part.intent, part.success, part.status], ["plan_selected", false, "error"]);
  assert.equal(part.message, "Catalog route unavailable");
});

void test("a work pick merges both works, routes them and consumes the question once", async () => {
  const script = { works: { "1": LUCKY_STAR, "2": EUPHONIUM }, itinerary: LUCKY_STAR_ROUTE };
  const harness = makeSelectionTurn({ selection: WORK_PICK, script, pending: ASKED });
  assert.deepEqual(await harness.turn.run(SELECTION_RUN_ID), { phase: "succeeded" });
  assert.deepEqual(harness.catalog.fetched, ["1", "2"]);
  assert.deepEqual(harness.catalog.planned, [["spot-1", "spot-2", "published-1"]]);
  assert.equal(harness.session.envelope.pendingClarification, null);
  assert.equal(harness.session.envelope.currentAnime, null);
});

void test("a merged work pick publishes both the rows and the route", async () => {
  const script = { works: { "1": LUCKY_STAR, "2": EUPHONIUM }, itinerary: LUCKY_STAR_ROUTE };
  const harness = makeSelectionTurn({ selection: WORK_PICK, script, pending: ASKED });
  await harness.turn.run(SELECTION_RUN_ID);
  const answered = harness.store.succeeded[0]?.responseData;
  const part = answeredPart(answered);
  assert.deepEqual([part.intent, part.success, part.status], ["plan_multi", true, "ok"]);
  assert.deepEqual(routeData(answered).results?.kind, "multi");
  assert.deepEqual(routeData(answered).itinerary?.point_count, 2);
});

void test("a work still syncing answers partial with the rows and no route", async () => {
  const syncing = { rows: [UJI_BRIDGE], synced_at: "2026-09-01T00:00:00Z", partial: true };
  const script = { works: { "1": LUCKY_STAR, "2": syncing }, itinerary: LUCKY_STAR_ROUTE };
  const harness = makeSelectionTurn({ selection: WORK_PICK, script, pending: ASKED });
  await harness.turn.run(SELECTION_RUN_ID);
  const answered = harness.store.succeeded[0]?.responseData;
  const part = answeredPart(answered);
  assert.deepEqual([part.intent, part.success, part.status], ["plan_multi", false, "partial"]);
  assert.deepEqual([harness.catalog.planned, routeData(answered).itinerary], [[], undefined]);
});

void test("a partial pick leaves the question open, so the user may pick again", async () => {
  const syncing = { rows: [UJI_BRIDGE], synced_at: "2026-09-01T00:00:00Z", partial: true };
  const script = { works: { "1": LUCKY_STAR, "2": syncing } };
  const harness = makeSelectionTurn({ selection: WORK_PICK, script, pending: ASKED });
  await harness.turn.run(SELECTION_RUN_ID);
  assert.equal(harness.session.envelope.pendingClarification?.id, 1);
});

void test("a single work picked becomes the anime the session is about", async () => {
  const one = { of: "candidates", candidateIds: ["1"], clarificationId: 1, locale: "ja" } as const;
  const script = { works: { "1": LUCKY_STAR }, itinerary: LUCKY_STAR_ROUTE };
  const harness = makeSelectionTurn({ selection: one, script, pending: ASKED });
  await harness.turn.run(SELECTION_RUN_ID);
  assert.deepEqual(harness.session.envelope.currentAnime, { bangumiId: "1", title: "らき☆すた" });
});

void test("a pick naming a question the session no longer has open is refused, not run", async () => {
  const stale = { of: "candidates", candidateIds: ["1"], clarificationId: 7, locale: "ja" } as const;
  const harness = makeSelectionTurn({ selection: stale, script: {}, pending: ASKED });
  assert.deepEqual(await harness.turn.run(SELECTION_RUN_ID), { phase: "succeeded" });
  assert.deepEqual(harness.catalog.fetched, []);
  const part = answeredPart(harness.store.succeeded[0]?.responseData);
  assert.deepEqual([part.intent, part.success, part.status], ["clarify", false, "invalid_request"]);
  assert.equal(part.message, "This choice expired; please try again.");
});

void test("a refused pick names the invalid_selection error the container names", async () => {
  const stale = { of: "candidates", candidateIds: ["1"], clarificationId: 7, locale: "ja" } as const;
  const harness = makeSelectionTurn({ selection: stale, script: {}, pending: ASKED });
  await harness.turn.run(SELECTION_RUN_ID);
  const part = answeredPart(harness.store.succeeded[0]?.responseData);
  assert.deepEqual(part.errors, [
    { code: "invalid_selection", message: "This choice expired; please try again.", details: {} },
  ]);
});
