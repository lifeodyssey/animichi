/**
 * #1389, the crash-resume half: an earlier turn's frozen route is byte-identical
 * in the context a RETRIED alarm assembles (spec §九 9.2 (1)).
 *
 * The claim is the one the freeze exists for and only a crash/retry pair can
 * make: 李博杰《深入理解 AI Agent》ch.2「缓存作为架构约束」—「即使后续会话重启，
 * 系统也会使用完全相同的替换字符串」. A retried alarm rebuilds the transcript from
 * Neon on a fresh incarnation's heap, so if anything on that path re-decided
 * the route's short form, the twelve stop ids an ordinal resolves against would
 * move — or vanish — between one attempt and the next.
 *
 * The pair runs over the REAL pi loop, the real step persistence and the real
 * transcript rebuild; only the provider socket and the `CATALOG` binding are
 * scripted.
 *
 * test-type: integration (real pi loop + scripted provider/catalog, no network).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { TurnStoreUnavailable } from "../src/agent/session/run-machine.ts";
import { toolReturnSummary } from "../src/agent/session/tool-return-summary.ts";
import { TWELVE_STOP_IDS } from "./doubles/catalog-payloads.ts";
import type { InMemoryTurnStore } from "./doubles/in-memory-turn-store.ts";
import {
  makeEnvelopeTurnStore,
  runEnvelopeTurn,
  type EnvelopeTurnParts,
} from "./doubles/make-envelope-turn.ts";
import {
  makeAnswerRow,
  makeNamedToolCallMessage,
  makeStep,
  makeStepResult,
  makeToolCallRow,
  USER_ROW,
} from "./doubles/make-loaded-turn.ts";
import { makeSequencedToolCallsStreamFn, type ScriptedToolCall } from "./doubles/pi-provider-double.ts";
import { RecordingEnvelopeStorage } from "./doubles/recording-envelope-storage.ts";

const EARLIER_RUN = "run-0";
const RESOLVE_CALL: ScriptedToolCall = { name: "resolve_anime", arguments: { title: "らき☆すた" } };

/** The twelve-stop route the earlier turn planned, and the line it was frozen
 * with when that step was written. */
const ROUTE_RETURN = JSON.stringify({
  status: "ok",
  itinerary_ref: `route:12:2@${EARLIER_RUN}`,
  ordered_point_ids: TWELVE_STOP_IDS,
  point_count: 12,
  total_minutes: 480,
});
const ROUTE_SUMMARY = toolReturnSummary("plan_route", ROUTE_RETURN);

/** The session as Neon holds it: one finished routing turn, then a new ask. */
const ROUTED_SESSION: Partial<EnvelopeTurnParts> = {
  transcript: [
    USER_ROW,
    makeToolCallRow(EARLIER_RUN, 0, makeNamedToolCallMessage("plan_route", "call-r")),
    makeAnswerRow("12 か所のルートです"),
    USER_ROW,
  ],
  earlierSteps: [
    { runId: EARLIER_RUN, steps: [makeStep(0, makeStepResult(ROUTE_RETURN, ROUTE_SUMMARY), "plan_route")] },
  ],
};

/** The scripted socket, with every context it was handed kept — a crashed turn
 * throws before `runEnvelopeTurn` can hand its own recording back. */
function recordingStream(seen: AgentMessage[][]): EnvelopeTurnParts["streamFn"] {
  const scripted = makeSequencedToolCallsStreamFn([RESOLVE_CALL]);
  return (model, context, options) => {
    seen.push([...context.messages] as AgentMessage[]);
    return scripted(model, context, options);
  };
}

/** Every tool return's text in one context — what a replay has to reproduce. */
function returnTextsIn(messages: readonly AgentMessage[]): string {
  return messages
    .flatMap((message) => ("role" in message && message.role === "toolResult" ? message.content : []))
    .flatMap((part) => (part.type === "text" ? part.text : []))
    .join("");
}

/** The attempt that read the earlier route back and then could not write its
 * own first step down. */
async function crashedOnFirstStep(
  storage: RecordingEnvelopeStorage, seen: AgentMessage[][],
): Promise<InMemoryTurnStore> {
  const store = makeEnvelopeTurnStore(ROUTED_SESSION);
  store.refuseStepsFrom = 0;
  await assert.rejects(
    runEnvelopeTurn({ ...ROUTED_SESSION, storage, store, streamFn: recordingStream(seen) }),
    TurnStoreUnavailable,
  );
  store.refuseStepsFrom = Number.POSITIVE_INFINITY;
  return store;
}

void test("the crashed attempt was shown the route's frozen summary", async () => {
  const seen: AgentMessage[][] = [];
  await crashedOnFirstStep(new RecordingEnvelopeStorage(), seen);
  assert.equal(returnTextsIn(seen[0] ?? []), ROUTE_SUMMARY);
});

void test("the retry is shown the same twelve stop ids, byte for byte", async () => {
  const storage = new RecordingEnvelopeStorage();
  const seen: AgentMessage[][] = [];
  const store = await crashedOnFirstStep(storage, seen);

  const retry = await runEnvelopeTurn({
    ...ROUTED_SESSION, storage, store, streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL]),
  });
  assert.deepEqual(retry.state, { phase: "succeeded" });
  assert.equal(returnTextsIn(retry.requests[0]?.messages ?? []), returnTextsIn(seen[0] ?? []));
  assert.match(returnTextsIn(retry.requests[0]?.messages ?? []), /"spot-2","spot-3"/);
});
