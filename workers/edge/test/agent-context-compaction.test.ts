/**
 * #1378 (spec §九 9.2): the per-request "newest 8" window is gone, and the one
 * dynamic path left is a batch pass that fires only near the window.
 *
 * The property these cases hold is the one the old window broke: a context
 * handed to the model twice is the same context. Under the trigger — which is
 * where every measured session sits, 870 tokens against 102,400 — the pass is
 * the identity, so request 1 and request 3 of a turn see the same bytes. Over
 * it, the pass is idempotent instead, because a return it shrank carries a mark
 * that keeps the next pass off it (李博杰《深入理解 AI Agent》ch.2 实验 2-10
 * 策略六: 阈值触发 + 批量压缩 + 防重复保护).
 *
 * test-type: unit (pure function; no clock, no I/O).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  CONTEXT_COMPACTION_TRIGGER_TOKENS,
  batchCompacted,
} from "../src/agent/session/context-compaction.ts";
import { makeLongSearchOutcome, makeToolTurn } from "./doubles/make-tool-transcript.ts";

/**
 * Wide enough that even its SUMMARY is over the 200-character cap: the ordered
 * candidate ids are kept verbatim, so a second pass over an unmarked summary
 * would fail to parse it and collapse the ids to `[resolve_anime: completed]`.
 * That is what the mark is for, and this is the case that can see it.
 */
const AMBIGUOUS = {
  outcome: "needs_disambiguation",
  clarification_reason: "anime_ambiguity",
  candidate_ids: Array.from({ length: 30 }, (_unused, index) => `90${String(index).padStart(2, "0")}`),
};

/** Two long tool returns and one short one — the three shapes the pass sorts. */
function makeHistory(): AgentMessage[] {
  return [
    ...makeToolTurn("らき☆すたの聖地は？", {
      id: "c-1", toolName: "resolve_anime", arguments: { title: "らき☆すた" }, outcome: AMBIGUOUS,
    }),
    ...makeToolTurn("鷲宮のあたり", {
      id: "c-2", toolName: "search_nearby", arguments: { location: "鷲宮神社" },
      outcome: makeLongSearchOutcome("らき☆すた"),
    }),
    ...makeToolTurn("ルートは？", {
      id: "c-3", toolName: "plan_route", arguments: { search_result_ref: "search:12:1" },
      outcome: { status: "stale_ref" },
    }),
  ];
}

/** One message big enough to put any context over the trigger by itself. */
function makeOverflowMessage(): AgentMessage {
  const chars = CONTEXT_COMPACTION_TRIGGER_TOKENS * 4 + 4_000;
  return { role: "user", content: "x".repeat(chars), timestamp: 0 };
}

/** The text a tool-result message carries after a pass. */
function returnTextAt(messages: readonly AgentMessage[], index: number): string {
  const message = messages[index] ?? { role: "user", content: "", timestamp: 0 };
  const parts = "role" in message && message.role === "toolResult" ? message.content : [];
  return parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

void test("under the trigger the whole context is handed over untouched", () => {
  const history = makeHistory();
  assert.deepEqual(batchCompacted(history), history);
  assert.match(returnTextAt(batchCompacted(history), 5), /"row_count":12/);
});

void test("three passes under the trigger answer the same bytes every time", () => {
  const history = makeHistory();
  const shaped = [1, 2, 3].map(() => JSON.stringify(batchCompacted(history)));
  assert.deepEqual(shaped, [shaped[0], shaped[0], shaped[0]]);
});

void test("over the trigger every long return becomes its marked summary", () => {
  const compacted = batchCompacted([makeOverflowMessage(), ...makeHistory()]);
  assert.equal(returnTextAt(compacted, 6), "[compacted] [search_nearby: found 12 spots for らき☆すた]");
});

void test("over the trigger a short return is still left as it was", () => {
  const compacted = batchCompacted([makeOverflowMessage(), ...makeHistory()]);
  assert.equal(returnTextAt(compacted, 9), '{"status":"stale_ref"}');
});

void test("a batch-compacted ambiguous resolve keeps its ordered candidate ids", () => {
  const compacted = batchCompacted([makeOverflowMessage(), ...makeHistory()]);
  const shrunk = returnTextAt(compacted, 3);
  assert.ok(shrunk.startsWith("[compacted] [resolve_anime: ambiguous, ordered_candidates="), shrunk);
  assert.match(shrunk, /"9029"\]\]$/);
  assert.equal(shrunk.includes("clarification_reason"), false);
});

void test("a second batch pass re-processes nothing the first one marked", () => {
  const once = batchCompacted([makeOverflowMessage(), ...makeHistory()]);
  assert.ok(returnTextAt(once, 3).length > 200, "the marked summary is itself over the cap");
  assert.deepEqual(batchCompacted(once), once);
});
