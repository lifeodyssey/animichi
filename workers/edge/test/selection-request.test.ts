/**
 * The selection half of a chat body, read and re-read (card #1288).
 *
 * The bodies below are the ones `apps/web` actually sends — `candidatePickBody`
 * for a pick and a part-less `recomputeMarker` message for a point recompute —
 * so a change that breaks the browser breaks this file first.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  selectionEnvelope,
  selectionIn,
  storedSelection,
} from "../src/agent/selection/selection-request.ts";
import { chatTurnText } from "../src/gateway/chat-envelope.ts";

const PICK_BUBBLE = { role: "user", parts: [{ type: "text", text: "らき☆すた" }] };
const RECOMPUTE_MARKER = { role: "user", parts: [] };

void test("a candidate pick is read with its clarification id", () => {
  const body = { messages: [PICK_BUBBLE], selected_candidate_ids: ["1"], clarification_id: 3 };
  assert.deepEqual(selectionIn(body, "ja"), {
    of: "candidates",
    candidateIds: ["1"],
    clarificationId: 3,
    locale: "ja",
  });
});

void test("a pick whose card carried no id reads as clarification zero, which no question has", () => {
  const body = { messages: [PICK_BUBBLE], selected_candidate_ids: ["1"], clarification_id: null };
  assert.deepEqual(selectionIn(body, "ja"), {
    of: "candidates",
    candidateIds: ["1"],
    clarificationId: 0,
    locale: "ja",
  });
});

void test("candidate ids are trimmed, emptied and first-occurrence deduped", () => {
  const body = { messages: [], selected_candidate_ids: [" 2 ", "", "1", "2"], clarification_id: 1 };
  assert.deepEqual(selectionIn(body, "en"), {
    of: "candidates",
    candidateIds: ["2", "1"],
    clarificationId: 1,
    locale: "en",
  });
});

void test("a point recompute is read with the coordinate origin the client shared", () => {
  const body = { messages: [RECOMPUTE_MARKER], selected_point_ids: ["p1"], origin_lat: 35.1, origin_lng: 139.2 };
  assert.deepEqual(selectionIn(body, "zh"), {
    of: "points",
    pointIds: ["p1"],
    origin: "35.1,139.2",
    locale: "zh",
  });
});

void test("points win over candidates, the order `_kind_from_request` tests them in", () => {
  const body = { messages: [], selected_point_ids: ["p1"], selected_candidate_ids: ["1"], clarification_id: 1 };
  assert.deepEqual(selectionIn(body, "ja"), { of: "points", pointIds: ["p1"], origin: null, locale: "ja" });
});

void test("an ordinary text turn carries no selection", () => {
  assert.equal(selectionIn({ messages: [PICK_BUBBLE] }, "ja"), null);
});

void test("a non-list selection field is refused rather than coerced", () => {
  assert.equal(selectionIn({ messages: [], selected_point_ids: "p1" }, "ja"), null);
});

void test("the part-less recompute marker submits an empty turn only when a selection carries it", () => {
  const body = { messages: [RECOMPUTE_MARKER] };
  assert.equal(chatTurnText(body, "ja", 4000, false), "");
  assert.throws(() => chatTurnText(body, "ja", 4000, true), /empty_message/);
});

void test("a selection round-trips through the column the intake writes it to", () => {
  const submitted = { of: "points", pointIds: [" p1 "], origin: "35,139", locale: "en" } as const;
  const held: unknown = JSON.parse(JSON.stringify(selectionEnvelope(submitted)));
  assert.deepEqual(storedSelection(held), { of: "points", pointIds: ["p1"], origin: "35,139", locale: "en" });
});

void test("an assistant answer envelope in that column is not a selection", () => {
  assert.equal(storedSelection({ intent: "plan_route", success: true }), null);
});

void test("a stored selection missing its ids reads as none at all", () => {
  assert.equal(storedSelection({ selection: { of: "points", pointIds: [], locale: "ja" } }), null);
});
