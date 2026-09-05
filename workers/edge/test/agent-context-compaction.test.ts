/**
 * #1378 (spec §九 9.2): the per-request "newest 8" window is gone, and the one
 * dynamic path left is a batch pass that fires only near the window.
 *
 * The property these cases hold is the one the old window broke: a context
 * handed to the model twice is the same context. Under the trigger — which is
 * where every measured session sits, 870 tokens against 102,400 — the pass is
 * the identity, so request 1 and request 3 of a turn see the same bytes. Over
 * it, the pass is a FIXPOINT instead: it asks `frozenSummaryOf`, which answers
 * "nothing to take" for a return that is already its own short form, so neither
 * its own output nor a summary frozen at write time can be summarised twice
 * (李博杰《深入理解 AI Agent》ch.2 实验 2-10 策略六: 阈值触发 + 批量压缩 +
 * 防重复保护).
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
import {
  TOOL_RETURN_MAX_CHARS,
  toolReturnSummary,
} from "../src/agent/session/tool-return-summary.ts";
import { makeLongSearchOutcome, makeToolTurn } from "./doubles/make-tool-transcript.ts";

/**
 * Wide enough that even its SUMMARY is over the 200-character cap: the ordered
 * candidate ids are kept verbatim, so a pass that failed to recognise a summary
 * would fail to parse it and collapse the ids to `[resolve_anime: completed]`.
 * That is what the recognition is for, and this is the case that can see it.
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

/**
 * An earlier turn's return, as `turn-transcript.ts` replays it: the summary
 * frozen when the step was written, carrying no mark of any kind.
 */
function makeWriteFrozenReturn(text: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: "c-9",
    toolName: "resolve_anime",
    content: [{ type: "text", text }],
    details: null,
    isError: false,
    timestamp: 0,
  };
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

void test("over the trigger every long return becomes its deterministic summary", () => {
  const compacted = batchCompacted([makeOverflowMessage(), ...makeHistory()]);
  assert.equal(returnTextAt(compacted, 6), "[search_nearby: found 12 spots for らき☆すた]");
});

void test("over the trigger a short return is still left as it was", () => {
  const compacted = batchCompacted([makeOverflowMessage(), ...makeHistory()]);
  assert.equal(returnTextAt(compacted, 9), '{"status":"stale_ref"}');
});

void test("a batch-compacted ambiguous resolve keeps its ordered candidate ids", () => {
  const compacted = batchCompacted([makeOverflowMessage(), ...makeHistory()]);
  const shrunk = returnTextAt(compacted, 3);
  assert.ok(shrunk.startsWith("[resolve_anime: ambiguous, ordered_candidates="), shrunk);
  assert.match(shrunk, /"9029"\]\]$/);
  assert.equal(shrunk.includes("clarification_reason"), false);
});

void test("a second batch pass re-processes nothing the first one shrank", () => {
  const once = batchCompacted([makeOverflowMessage(), ...makeHistory()]);
  assert.ok(returnTextAt(once, 3).length > 200, "the summary is itself over the cap");
  assert.deepEqual(batchCompacted(once), once);
});

/**
 * The case the review found: a summary FROZEN AT WRITE TIME carries no mark of
 * any kind, so a pass that recognised only its own output would re-summarise
 * this one — `[resolve_anime: ambiguous, ordered_candidates=[…]]` does not
 * parse as JSON, and the generic line it collapses to takes the ordered ids
 * with it. Every earlier turn arrives in exactly this shape (#1377), so it is
 * the shape the trigger is most likely to meet.
 */
void test("a write-frozen candidate summary survives a forced pass byte-identical", () => {
  const frozen = toolReturnSummary("resolve_anime", JSON.stringify(AMBIGUOUS));
  assert.ok(frozen.length > TOOL_RETURN_MAX_CHARS, "the frozen summary is itself over the cap");
  const held = [makeOverflowMessage(), makeWriteFrozenReturn(frozen)];
  assert.equal(returnTextAt(batchCompacted(held), 1), frozen);
  assert.match(returnTextAt(batchCompacted(held), 1), /"9029"\]\]$/);
});
