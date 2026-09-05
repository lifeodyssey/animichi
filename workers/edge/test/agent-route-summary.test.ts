/**
 * #1389 (spec §九 9.2): a frozen `plan_route` summary keeps the itinerary ref
 * and the ordered stop ids, so an ordinal follow-up still has something to land
 * on three turns later.
 *
 * 李博杰《深入理解 AI Agent》ch.2 states the rule these cases hold: a tool
 * result's replacement string is frozen when it first appears, so whatever the
 * summariser drops is dropped for the rest of the session. `plan_route` used to
 * drop everything but the count, and a count is not something "the second stop"
 * can resolve against — which is exactly the loss the ambiguous-resolve branch
 * already refuses to take.
 *
 * test-type: unit (pure functions; no clock, no I/O).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { frozenSummaryOf } from "../src/agent/session/frozen-tool-return.ts";
import { batchCompacted } from "../src/agent/session/context-compaction.ts";
import {
  TOOL_RETURN_MAX_CHARS,
  toolReturnSummary,
} from "../src/agent/session/tool-return-summary.ts";
import { resumedTranscript } from "../src/agent/session/turn-transcript.ts";
import { TWELVE_STOP_IDS } from "./doubles/catalog-payloads.ts";
import {
  makeAnswerRow,
  makeLoadedTurn,
  makeNamedToolCallMessage,
  makeStep,
  makeStepResult,
  makeToolCallRow,
  MODEL,
  USER_ROW,
} from "./doubles/make-loaded-turn.ts";

const EARLIER_RUN = "run-0";
const ROUTE_REF = "route:12:2@run-0";

/** The outcome `plan_route` answers a twelve-stop route with. */
const ROUTE_RETURN = JSON.stringify({
  status: "ok",
  itinerary_ref: ROUTE_REF,
  ordered_point_ids: TWELVE_STOP_IDS,
  point_count: 12,
  total_minutes: 480,
});

const ROUTE_SUMMARY = toolReturnSummary("plan_route", ROUTE_RETURN);

/** The earlier turn that planned the route, then this run's own user row. */
function makeRoutedSession() {
  return makeLoadedTurn({
    transcript: [
      USER_ROW,
      makeToolCallRow(EARLIER_RUN, 0, makeNamedToolCallMessage("plan_route", "call-r")),
      makeAnswerRow("12 か所のルートです"),
      USER_ROW,
    ],
    earlierSteps: [
      { runId: EARLIER_RUN, steps: [makeStep(0, makeStepResult(ROUTE_RETURN, ROUTE_SUMMARY), "plan_route")] },
    ],
  });
}

/** Every tool-result text of one rebuilt transcript, joined. */
function returnTextsIn(messages: readonly AgentMessage[]): string {
  return messages
    .flatMap((message) => ("role" in message && message.role === "toolResult" ? message.content : []))
    .flatMap((part) => (part.type === "text" ? part.text : []))
    .join("");
}

/**
 * The stops one summary names, read the ONLY way a later turn can read them:
 * out of the frozen line, which is all that turn is shown of the route. Drop
 * the ids from the summary and every ordinal below resolves to nothing.
 */
function orderedStopsIn(summary: string): string[] {
  const listed = /ordered_stops=(\[[^\]]*\])/.exec(summary) ?? [];
  return JSON.parse(listed[1] ?? "[]") as string[];
}

/** One route return over `count` stops, ids shaped like the catalog's own. */
function makeRouteReturn(count: number): string {
  const stops = Array.from({ length: count }, (_unused, index) => `catalog-point-${String(index).padStart(12, "0")}`);
  return JSON.stringify({
    status: "ok", itinerary_ref: ROUTE_REF, ordered_point_ids: stops,
    point_count: count, total_minutes: 480,
  });
}

void test("a routed return summarises to its ref and its stops in order", () => {
  assert.equal(
    toolReturnSummary("plan_route", JSON.stringify({
      status: "ok", itinerary_ref: "route:2:2@run-0",
      ordered_point_ids: ["spot-1", "spot-2"], point_count: 2, total_minutes: 120,
    })),
    '[plan_route: itinerary_ref=route:2:2@run-0, ordered_stops=["spot-1","spot-2"], total_minutes=120]',
  );
});

void test("a twelve-stop route is long enough to be frozen at all", () => {
  assert.ok(ROUTE_RETURN.length > TOOL_RETURN_MAX_CHARS, ROUTE_RETURN);
  assert.equal(frozenSummaryOf("plan_route", [{ type: "text", text: ROUTE_RETURN }]), ROUTE_SUMMARY);
});

void test("the frozen summary keeps all twelve stop ids in visit order", () => {
  assert.deepEqual(orderedStopsIn(ROUTE_SUMMARY), [...TWELVE_STOP_IDS]);
  assert.match(ROUTE_SUMMARY, /itinerary_ref=route:12:2@run-0,/);
});

void test("ids the bound cannot hold are kept anyway, and the duration goes", () => {
  const summary = toolReturnSummary("plan_route", makeRouteReturn(12));
  assert.ok(summary.length > TOOL_RETURN_MAX_CHARS, summary);
  assert.equal(orderedStopsIn(summary).length, 12);
  assert.equal(summary.includes("total_minutes"), false);
});

/**
 * The worst case, and its price. The catalog refuses an itinerary over
 * `MAX_ITINERARY_POINT_IDS = 500` (`workers/catalog/src/router.ts:64`) and
 * expands every planned cluster back to all its member points on the way out
 * (`plan-itinerary.ts:104-105`), so 500 is the most ids one route can carry —
 * and this line is frozen into the session's context for good. The byte size
 * rides the assertion message so a reader meets the cost as a number.
 */
void test("a 500-stop route keeps all 500 ids in order, at a stated price", () => {
  const summary = toolReturnSummary("plan_route", makeRouteReturn(500));
  const stops = orderedStopsIn(summary);
  assert.equal(stops.length, 500, `the frozen worst case is ${String(summary.length)} chars`);
  assert.equal(stops[1], "catalog-point-000000000001");
  assert.equal(stops[499], "catalog-point-000000000499");
});

void test("a route that planned nothing keeps the count line it always had", () => {
  assert.equal(
    toolReturnSummary("plan_route", JSON.stringify({ status: "empty", point_count: 0 })),
    "[plan_route: planned route with 0 stops]",
  );
});

void test("a later turn is shown the ref and the stops the route was frozen with", () => {
  const seeded = resumedTranscript(makeRoutedSession(), MODEL).messages;
  assert.equal(returnTextsIn(seeded), ROUTE_SUMMARY);
  assert.deepEqual(orderedStopsIn(returnTextsIn(seeded)), [...TWELVE_STOP_IDS]);
});

void test("two alarms over that session rebuild byte-identical route returns", () => {
  const turn = makeRoutedSession();
  const first = resumedTranscript(turn, MODEL).messages;
  const second = resumedTranscript(turn, MODEL).messages;
  assert.equal(returnTextsIn(second), returnTextsIn(first));
  assert.deepEqual(second, first);
});

void test("the second stop of an earlier turn's route resolves out of the summary", () => {
  const shown = returnTextsIn(resumedTranscript(makeRoutedSession(), MODEL).messages);
  assert.equal(orderedStopsIn(shown)[1], TWELVE_STOP_IDS[1]);
  assert.equal(orderedStopsIn(shown)[10], TWELVE_STOP_IDS[10]);
});

void test("a batch pass over a frozen route summary answers the same bytes", () => {
  const held: AgentMessage[] = [
    { role: "user", content: "x".repeat(500_000), timestamp: 0 },
    {
      role: "toolResult", toolCallId: "call-r", toolName: "plan_route",
      content: [{ type: "text", text: ROUTE_SUMMARY }], details: null, isError: false, timestamp: 0,
    },
  ];
  assert.deepEqual(batchCompacted(held), held);
  assert.equal(frozenSummaryOf("plan_route", [{ type: "text", text: ROUTE_SUMMARY }]), undefined);
});
