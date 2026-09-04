/**
 * W2-4 (#1290): what the model is actually shown of an older conversation.
 *
 * The two invariants these cases hold are the reason the tier is hand-rolled
 * rather than pi's native, model-written compaction: the retention window is
 * exact, and the whole pass is a FIXPOINT — the raw history is replayed and
 * re-compacted on every alarm (`turn-transcript.ts`), so a pass that changed
 * its own output would drift a little further from the transcript each turn.
 *
 * test-type: unit (no clock, no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  KEEP_RECENT_MESSAGES,
  compactToolReturns,
} from "../src/agent/session/context-compaction.ts";
import { RetainedEntityLedger } from "../src/agent/memory/retained-entity-ledger.ts";
import { makeLongSearchOutcome, makeToolTurn } from "./doubles/make-tool-transcript.ts";

const AMBIGUOUS = {
  outcome: "needs_disambiguation",
  clarification_reason: "anime_ambiguity",
  candidate_ids: ["485", "2907"],
  padding: "x".repeat(300),
};

/**
 * Five tool turns and a trailing user message — sixteen messages, so the cut
 * falls exactly ON a tool return (index 8, the newest message the window must
 * keep). That alignment is deliberate: with the boundary sitting on an
 * assistant message instead, an off-by-one in the window would be invisible,
 * because only tool returns are ever shaped.
 */
function makeHistory(): AgentMessage[] {
  return [
    ...makeToolTurn("らき☆すたの聖地は？", {
      id: "c-1", toolName: "resolve_anime", arguments: { title: "らき☆すた" }, outcome: AMBIGUOUS,
    }),
    ...makeToolTurn("鷲宮のあたり", {
      id: "c-2", toolName: "search_nearby", arguments: { location: "鷲宮神社" },
      outcome: makeLongSearchOutcome("らき☆すた"),
    }),
    ...makeToolTurn("もっと", {
      id: "c-3", toolName: "search_bangumi", arguments: { bangumi_id: "1" },
      outcome: makeLongSearchOutcome("らき☆すた"),
    }),
    ...makeToolTurn("ルートは？", {
      id: "c-4", toolName: "plan_route", arguments: { search_result_ref: "search:12:1" },
      outcome: { status: "ok", itinerary_ref: "route:12:2", point_count: 12, total_minutes: 240 },
    }),
    ...makeToolTurn("ゆっくりで", {
      id: "c-5", toolName: "plan_route",
      arguments: { search_result_ref: "search:12:1", pacing: "chill" },
      outcome: { status: "ok", itinerary_ref: "route:12:3", point_count: 12, total_minutes: 300 },
    }),
    { role: "user", content: "ありがとう", timestamp: 0 },
  ];
}

/** The text a tool-result message carries after a pass. */
function returnTextAt(messages: readonly AgentMessage[], index: number): string {
  const message = messages[index] ?? { role: "user", content: "", timestamp: 0 };
  const parts = "role" in message && message.role === "toolResult" ? message.content : [];
  return parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function compacted(messages: readonly AgentMessage[], ledger = RetainedEntityLedger.empty) {
  return compactToolReturns(messages, ledger, null);
}

void test("the newest messages of the window are handed over untouched", () => {
  const history = makeHistory();
  const { messages } = compacted(history);
  const window = history.length - KEEP_RECENT_MESSAGES;
  assert.equal(messages.length, history.length);
  assert.match(returnTextAt(history, window), /"row_count":12/);
  assert.deepEqual(messages.slice(window), history.slice(window));
});

void test("an old long search return becomes its deterministic summary", () => {
  const { messages } = compacted(makeHistory());
  assert.equal(returnTextAt(messages, 5), "[search_nearby: found 12 spots for らき☆すた]");
});

void test("the entity of a shrunken call lands in the retained ledger", () => {
  const { retained } = compacted(makeHistory());
  assert.deepEqual(retained.entities, [
    { toolName: "resolve_anime", value: "らき☆すた" },
    { toolName: "search_nearby", value: "鷲宮神社" },
  ]);
});

void test("an ambiguous resolve keeps its ordered candidate ids verbatim", () => {
  const { messages } = compacted(makeHistory());
  assert.equal(returnTextAt(messages, 2), '[resolve_anime: ambiguous, ordered_candidates=["485","2907"]]');
});

void test("compacting the replayed history twice is a fixpoint", () => {
  const history = makeHistory();
  const once = compacted(history);
  const twice = compactToolReturns(history, once.retained, null);
  assert.deepEqual(twice.messages, once.messages);
  assert.deepEqual(twice.retained.entities, once.retained.entities);
});

void test("the current turn's own tool returns are never touched", () => {
  const history = makeHistory();
  const current = history.slice(-KEEP_RECENT_MESSAGES);
  assert.deepEqual(compacted(current).messages, current);
  assert.equal(compacted(current).retained.isEmpty, true);
});

void test("an old SHORT return is left as it was", () => {
  const history = [
    ...makeToolTurn("短い", {
      id: "c-1", toolName: "search_bangumi", arguments: { bangumi_id: "1" },
      outcome: { outcome: "empty", anime_title: "らき☆すた", partial: false },
    }),
    ...makeToolTurn("次", {
      id: "c-2", toolName: "plan_route", arguments: { search_result_ref: "search:1:1" },
      outcome: { status: "stale_ref" },
    }),
    ...makeToolTurn("その次", {
      id: "c-3", toolName: "plan_route", arguments: { search_result_ref: "search:1:1" },
      outcome: { status: "stale_ref" },
    }),
  ];
  assert.deepEqual(compacted(history).messages, history);
});

void test("a title the session already resolved is not retained a second time", () => {
  const { retained } = compactToolReturns(makeHistory(), RetainedEntityLedger.empty, "らき☆すた");
  assert.deepEqual(retained.entities, [{ toolName: "search_nearby", value: "鷲宮神社" }]);
});
