/**
 * W2-2 (#1288): the place half of a clarification, and the frames a selection
 * streams while it runs.
 *
 * A place pick consumes the coordinates the question was ASKED with — it never
 * geocodes the label again — so the assertion that matters is which point the
 * catalog was searched around.
 *
 * test-type: unit (fake clock; no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { ChatResponseDataPart } from "@animichi/contract";
import { WASHINOMIYA } from "./doubles/catalog-payloads.ts";
import { SELECTION_RUN_ID, makeSelectionTurn } from "./doubles/make-selection-turn.ts";

const KUKI = { id: "seed:kuki", title: "久喜駅", lat: 36.0621, lng: 139.6669, effective_radius_m: 3_000 };
const UNPINNED = { id: "seed:nowhere", title: "どこか" };
const PLACE_PICK = { of: "candidates", candidateIds: ["seed:kuki"], clarificationId: 1, locale: "ja" } as const;
const ASKED = { reason: "place_ambiguity", candidates: [KUKI] };

function answeredPart(responseData: unknown): ChatResponseDataPart {
  return responseData as ChatResponseDataPart;
}

void test("a place pick searches the coordinates the question was asked with", async () => {
  const script = { nearby: [WASHINOMIYA] };
  const harness = makeSelectionTurn({ selection: PLACE_PICK, script, pending: ASKED });
  assert.deepEqual(await harness.turn.run(SELECTION_RUN_ID), { phase: "succeeded" });
  assert.deepEqual(harness.catalog.searched, [{ lat: 36.0621, lng: 139.6669 }]);
});

void test("a place pick answers search_nearby with the rows it found", async () => {
  const script = { nearby: [WASHINOMIYA] };
  const harness = makeSelectionTurn({ selection: PLACE_PICK, script, pending: ASKED });
  await harness.turn.run(SELECTION_RUN_ID);
  const part = answeredPart(harness.store.succeeded[0]?.responseData);
  assert.deepEqual([part.intent, part.success, part.status], ["search_nearby", true, "ok"]);
  assert.equal(part.message, "周辺の聖地を検索しました。");
});

void test("a place with no spots nearby still answers the question that was asked", async () => {
  const harness = makeSelectionTurn({ selection: PLACE_PICK, script: { nearby: [] }, pending: ASKED });
  await harness.turn.run(SELECTION_RUN_ID);
  const part = answeredPart(harness.store.succeeded[0]?.responseData);
  assert.deepEqual([part.status, part.message], ["empty", "その場所の周辺には聖地が見つかりませんでした。"]);
  assert.equal(harness.session.envelope.pendingClarification, null);
});

void test("a nearby search the catalog refuses leaves the question open", async () => {
  const harness = makeSelectionTurn({ selection: PLACE_PICK, script: {}, pending: ASKED });
  await harness.turn.run(SELECTION_RUN_ID);
  const part = answeredPart(harness.store.succeeded[0]?.responseData);
  assert.deepEqual([part.status, part.success], ["error", false]);
  assert.equal(harness.session.envelope.pendingClarification?.id, 1);
});

void test("a candidate the question offered without coordinates cannot be searched around", async () => {
  const pick = { of: "candidates", candidateIds: ["seed:nowhere"], clarificationId: 1, locale: "ja" } as const;
  const pending = { reason: "place_ambiguity", candidates: [UNPINNED] };
  const harness = makeSelectionTurn({ selection: pick, script: {}, pending });
  await harness.turn.run(SELECTION_RUN_ID);
  const part = answeredPart(harness.store.succeeded[0]?.responseData);
  assert.equal(part.message, "This place choice expired; please try again.");
  assert.deepEqual(harness.catalog.searched, []);
});

void test("a selection streams its step as the tool theater's own frames", async () => {
  const script = { nearby: [WASHINOMIYA] };
  const harness = makeSelectionTurn({ selection: PLACE_PICK, script, pending: ASKED });
  await harness.turn.run(SELECTION_RUN_ID);
  assert.deepEqual(harness.frames.map((frame) => frame.type), [
    "start",
    "start-step",
    "tool-input-start",
    "tool-input-available",
    "tool-output-available",
    "data-response",
    "data-response",
    "finish-step",
    "finish",
  ]);
});

void test("the step frames name the tool the container names, under one call id", async () => {
  const script = { nearby: [WASHINOMIYA] };
  const harness = makeSelectionTurn({ selection: PLACE_PICK, script, pending: ASKED });
  await harness.turn.run(SELECTION_RUN_ID);
  const [opened, , settled] = harness.frames.slice(2);
  const toolCallId = opened?.toolCallId;
  assert.equal(opened?.toolName, "search_nearby");
  assert.deepEqual(settled, { type: "tool-output-available", toolCallId, output: { status: "ok" } });
});

void test("a step that failed streams the error frame rather than an outcome", async () => {
  const harness = makeSelectionTurn({ selection: PLACE_PICK, script: {}, pending: ASKED });
  await harness.turn.run(SELECTION_RUN_ID);
  const settled = harness.frames.find((frame) => frame.type === "tool-output-error");
  assert.equal(settled?.errorText, "Something went wrong. Please try again.");
});
