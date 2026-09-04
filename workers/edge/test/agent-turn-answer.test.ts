/**
 * W1-7b (#1283): the typed turn output and where its `data-response` frame sits.
 *
 * The expected sequences are not written here — they are READ off the recorded
 * captures `apps/agent/tests/fixtures/chat_stream/*.sse`, the same files
 * `apps/web`'s suite replays and `packages/contract` parses. The captures end on
 * `[DONE]`, which the SSE channel appends rather than the frame projection, so
 * that one token is dropped and nothing else is.
 *
 * test-type: unit (fake clock; scripted provider socket and catalog binding, no
 * network and no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { ANSWER_TOOL_NAME } from "@animichi/contract/agent-tool-schemas";
import {
  AMBIGUOUS_LUCKY_STAR,
  makeAnsweredTurn,
  type AnsweredTurn,
} from "./doubles/make-answered-turn.ts";
import type { TurnFrame } from "../src/agent/session/turn-frames.ts";
import { makeRejectedRequestStreamFn } from "./doubles/pi-provider-double.ts";

const RESOLVE = { name: "resolve_anime", arguments: { title: "らき☆すた" } };
const SEARCH = { name: "search_bangumi", arguments: { bangumi_id: "1" } };
const ROUTE = { name: "plan_route", arguments: { search_result_ref: "search:2:1" } };

const answer = (args: Record<string, unknown>) => ({ name: ANSWER_TOOL_NAME, arguments: args });
const ROUTE_ANSWER = answer({ kind: "route", message: "2件を徒歩ルートにまとめました。" });
const CLARIFY_ANSWER = answer({ kind: "clarify", message: "どちら？", reason: "anime_ambiguity" });
const QA_ANSWER = answer({ kind: "qa", message: "聖地巡礼は…" });

/** The frame types one recorded capture carries, without its `[DONE]`. */
function capturedTypes(name: string): string[] {
  const path = fileURLToPath(new URL(`../../../apps/agent/tests/fixtures/chat_stream/${name}.sse`, import.meta.url));
  const events = readFileSync(path, "utf8").trim().split("\n\n");
  return events.slice(0, -1).map((event) => String((JSON.parse(event.slice(6)) as { type: unknown }).type));
}

function frameTypes(turn: AnsweredTurn): unknown[] {
  return turn.frames.map((frame) => frame.type);
}

/** The answer frames, in the order they went out. */
function answerFrames(turn: AnsweredTurn): TurnFrame[] {
  return turn.frames.filter((frame) => frame.type === "data-response");
}

/** The ids the answer frames rode under — equal ids are what makes the second
 * part an overwrite of the first rather than a second answer. */
function answerIds(turn: AnsweredTurn): unknown[] {
  return answerFrames(turn).map((frame) => frame.id);
}

/** The n-th answer part's payload. */
function answerPart(turn: AnsweredTurn, index: number): Record<string, unknown> {
  const frame = answerFrames(turn)[index];
  assert.ok(frame, `no data-response frame at index ${String(index)}`);
  return frame.data as Record<string, unknown>;
}

void test("a search that becomes a route pushes the capture's own frame sequence", async () => {
  const turn = await makeAnsweredTurn({ calls: [RESOLVE, SEARCH, ROUTE, ROUTE_ANSWER] });
  assert.deepEqual(frameTypes(turn), capturedTypes("search"));
});

void test("the route answer carries the itinerary the tools stored, not the model's words", async () => {
  const turn = await makeAnsweredTurn({ calls: [RESOLVE, SEARCH, ROUTE, ROUTE_ANSWER] });
  const whole = answerPart(turn, 1);
  assert.deepEqual(answerPart(turn, 0), { intent: "plan_route" });
  assert.deepEqual(answerIds(turn), ["response", "response"]);
  assert.deepEqual(whole.ui, { component: "RoutePlannerWizard" });
  assert.equal(whole.status, "ok");
  assert.deepEqual(Object.keys(whole.data as object), ["itinerary"]);
});

void test("a clarify turn pushes the clarify capture's sequence and the pending candidates", async () => {
  const turn = await makeAnsweredTurn({
    calls: [RESOLVE, CLARIFY_ANSWER],
    resolveOutcome: AMBIGUOUS_LUCKY_STAR,
  });
  assert.deepEqual(frameTypes(turn), capturedTypes("clarify"));
  const whole = answerPart(turn, 1);
  assert.equal(whole.status, "needs_clarification");
  assert.deepEqual(whole.data, {
    reason: "anime_ambiguity",
    clarification_id: 1,
    candidates: [
      { id: "1", title: "らき☆すた", cover_url: undefined, points_count: undefined, lat: undefined, lng: undefined },
      { id: "2", title: "らき☆すた OVA", cover_url: undefined, points_count: undefined, lat: undefined, lng: undefined },
    ],
  });
});

void test("a failed turn pushes the error capture's sequence and no answer at all", async () => {
  const turn = await makeAnsweredTurn({ streamFn: makeRejectedRequestStreamFn("gateway said no") });
  assert.deepEqual(frameTypes(turn), capturedTypes("error"));
  assert.deepEqual(answerFrames(turn), []);
});

/** The `respond` call itself is never a tool part: the captures show a turn's
 * answer as an answer, and Python's final-result tool was hidden the same way. */
void test("the answer tool leaves no tool frames behind", async () => {
  const turn = await makeAnsweredTurn({ calls: [QA_ANSWER] });
  assert.deepEqual(frameTypes(turn), ["start", "start-step", "data-response", "data-response", "finish-step", "finish"]);
});

void test("the assistant row commits the same part the stream pushed", async () => {
  const turn = await makeAnsweredTurn({ calls: [RESOLVE, SEARCH, ROUTE, ROUTE_ANSWER] });
  const [settled] = turn.store.succeeded;
  assert.ok(settled);
  assert.deepEqual(settled.responseData, answerPart(turn, 1));
  assert.equal(settled.answer, "2件を徒歩ルートにまとめました。");
});

/** Python's end-of-run repair (`animichi_runner`), which #1280 had to defer. */
void test("a clarify answer leaves the question the tool asked still open", async () => {
  const turn = await makeAnsweredTurn({
    calls: [RESOLVE, CLARIFY_ANSWER],
    resolveOutcome: AMBIGUOUS_LUCKY_STAR,
  });
  assert.equal(turn.session.envelope.pendingClarification?.reason, "anime_ambiguity");
});

/** pi's loop ends cleanly on a turn with no tool call, so "did not answer" is a
 * reachable state Python's forced `output_type` never had. It must not be read
 * as "answered something that was not a clarification". */
void test("a turn that submits no answer at all leaves the question untouched", async () => {
  const turn = await makeAnsweredTurn({ calls: [RESOLVE], resolveOutcome: AMBIGUOUS_LUCKY_STAR });
  assert.equal(turn.session.envelope.pendingClarification?.reason, "anime_ambiguity");
});

void test("any other answer closes the question the model never voiced", async () => {
  const turn = await makeAnsweredTurn({
    calls: [RESOLVE, QA_ANSWER],
    resolveOutcome: AMBIGUOUS_LUCKY_STAR,
  });
  assert.equal(turn.session.envelope.pendingClarification, null);
});

/** The validation loop: pi hands a tool's throw back to the model, so a kind
 * with no evidence behind it is retried instead of published. */
void test("a route answer with nothing planned is rejected and never becomes a part", async () => {
  const turn = await makeAnsweredTurn({ calls: [answer({ kind: "route", message: "はい" }), QA_ANSWER] });
  assert.deepEqual(answerPart(turn, 0), { intent: "general_qa" });
});
