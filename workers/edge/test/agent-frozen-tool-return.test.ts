/**
 * #1378 (spec §九 9.2): a tool return's short form is decided ONCE, when the
 * step is written, and every later read hands the model the same bytes.
 *
 * 李博杰《深入理解 AI Agent》ch.2「缓存作为架构约束」:「工具结果的替换字符串在
 * 首次出现时就被冻结……即使后续会话重启，系统也会使用完全相同的替换字符串」. The
 * cases below are that sentence made falsifiable from both ends: the rebuild
 * READS a stored string and never decides one — a result with no frozen summary
 * replays whole rather than being summarised late — and this run's OWN settled
 * steps replay whole too, so a retried alarm resumes on the bytes its first
 * attempt saw.
 *
 * test-type: unit (pure functions; no clock, no I/O).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  TOOL_RETURN_MAX_CHARS,
  frozenSummaryOf,
} from "../src/agent/session/frozen-tool-return.ts";
import { resumedTranscript } from "../src/agent/session/turn-transcript.ts";
import {
  makeAnswerRow,
  makeLoadedTurn,
  makeStep,
  makeStepResult,
  makeToolCallMessage,
  makeToolCallRow,
  MODEL,
  RUN_ID,
  USER_ROW,
} from "./doubles/make-loaded-turn.ts";

const EARLIER_RUN = "run-0";
const AMBIGUOUS = JSON.stringify({
  outcome: "needs_disambiguation",
  clarification_reason: "anime_ambiguity",
  candidate_ids: ["485", "2907"],
  candidates: Array.from({ length: 20 }, (_unused, index) => ({ title: `らき☆すた ${String(index)}` })),
});
const FROZEN = '[resolve_anime: ambiguous, ordered_candidates=["485","2907"]]';
const SHORT = JSON.stringify({ status: "stale_ref" });

/** The earlier turn, its long call answered and frozen, then this run's user row. */
function makeSessionWith(result = makeStepResult(AMBIGUOUS, FROZEN)) {
  return makeLoadedTurn({
    transcript: [
      USER_ROW,
      makeToolCallRow(EARLIER_RUN, 0, makeToolCallMessage("call-a")),
      makeAnswerRow("どちらですか"),
      USER_ROW,
    ],
    earlierSteps: [{ runId: EARLIER_RUN, steps: [makeStep(0, result)] }],
  });
}

/** Every tool-result text of one rebuilt transcript, joined. */
function returnTextsIn(messages: readonly AgentMessage[]): string {
  return messages
    .flatMap((message) => ("role" in message && message.role === "toolResult" ? message.content : []))
    .flatMap((part) => (part.type === "text" ? part.text : []))
    .join("");
}

void test("a long return over the cap freezes to its deterministic summary", () => {
  assert.equal(frozenSummaryOf("resolve_anime", [{ type: "text", text: AMBIGUOUS }]), FROZEN);
});

void test("a return inside the cap freezes to nothing at all", () => {
  const text = "x".repeat(TOOL_RETURN_MAX_CHARS);
  assert.equal(frozenSummaryOf("search_nearby", [{ type: "text", text }]), undefined);
  assert.equal(frozenSummaryOf("plan_route", [{ type: "text", text: SHORT }]), undefined);
});

void test("an earlier turn replays as the summary frozen when it was written", () => {
  const seeded = resumedTranscript(makeSessionWith(), MODEL).messages;
  assert.equal(returnTextsIn(seeded), FROZEN);
  assert.equal(returnTextsIn(seeded).includes("clarification_reason"), false);
});

void test("two alarms over the same session rebuild byte-identical returns", () => {
  const turn = makeSessionWith();
  const first = resumedTranscript(turn, MODEL).messages;
  const second = resumedTranscript(turn, MODEL).messages;
  assert.equal(returnTextsIn(second), returnTextsIn(first));
  assert.deepEqual(second, first);
});

void test("a result with no frozen summary replays whole, never summarised late", () => {
  const seeded = resumedTranscript(makeSessionWith(makeStepResult(AMBIGUOUS)), MODEL).messages;
  assert.equal(returnTextsIn(seeded), AMBIGUOUS);
});

void test("this run's own settled step replays whole, for the attempt it resumes", () => {
  const turn = makeLoadedTurn({
    transcript: [USER_ROW, makeToolCallRow(RUN_ID, 0, makeToolCallMessage("call-a"))],
    steps: [makeStep(0, makeStepResult(AMBIGUOUS, FROZEN))],
  });
  const resumed = resumedTranscript(turn, MODEL);
  assert.equal(returnTextsIn(resumed.messages), AMBIGUOUS);
  assert.equal(resumed.settledSteps, 1);
});
