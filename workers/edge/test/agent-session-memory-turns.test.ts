/**
 * W2-4 (#1290), rewritten by #1378: three turns of one session, over the real
 * pi loop.
 *
 * Only the whole round trip can answer these. The first claim is the one #1290
 * made: a turn far from where a fact was recorded still ACTS on it — the pacing
 * turn 1 planned with and the title rescued when turn 1's own return was frozen
 * both reach turn 3's model, through the Durable Object storage and the
 * `<agent_status>` bar (#1379). The second is #1378's: turn 1's long return
 * reaches turn 3 as the summary frozen when it was WRITTEN, and nothing
 * re-shapes it in between — so no message's text changes between one model
 * request of a turn and the next, which is exactly what the retired "newest 8"
 * window did.
 *
 * Only the provider socket and the catalog binding are scripted; the loop, the
 * step persistence, the envelope staging and the transcript rebuild are the
 * real ones.
 *
 * test-type: integration (real pi loop + scripted provider/catalog, no network).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { RunSteps, TranscriptRow } from "../src/agent/session/turn-store.ts";
import { makeSequencedToolCallsStreamFn, type ScriptedToolCall } from "./doubles/pi-provider-double.ts";
import {
  runEnvelopeTurn,
  type EnvelopeTurnRun,
  type ModelRequest,
} from "./doubles/make-envelope-turn.ts";
import { RecordingEnvelopeStorage } from "./doubles/recording-envelope-storage.ts";

const PLACE = "鷲宮神社";
const TITLE = "らき☆すた";

/**
 * Five tool calls, so a turn leaves a session's worth of history behind it for
 * the next one to replay. The first call is `resolve_anime` on purpose: a wide
 * disambiguation is the one catalog outcome that is genuinely long — so it is
 * the one the freeze shrinks and the one that rescues an entity — and it is
 * also the one whose ordered candidate ids an ordinal follow-up depends on.
 */
function busyTurn(runId: string): ScriptedToolCall[] {
  return [
    { name: "resolve_anime", arguments: { title: TITLE } },
    { name: "search_nearby", arguments: { location: PLACE, radius_m: 3000 } },
    { name: "search_bangumi", arguments: { bangumi_id: "1" } },
    { name: "search_nearby", arguments: { location: "幸手権現堂", radius_m: 3000 } },
    // The ref names THIS run: a mint carries its issuing run since #1377, so a
    // model naming another turn's handle would be answered `stale_ref`.
    { name: "plan_route", arguments: { search_result_ref: `search:1:1@${runId}`, pacing: "chill" } },
  ];
}

/** The turn in the middle, which calls nothing at all. */
function quietTurn(): ScriptedToolCall[] {
  return [];
}

/** A disambiguation wide enough that its own JSON is over the 200-char cap. */
const WIDE_AMBIGUITY = {
  outcome: "needs_disambiguation",
  candidates: Array.from({ length: 30 }, (_unused, index) => ({
    bangumi_id: `900${String(index)}`,
    title: `${TITLE} ${String(index)}`,
  })),
};

/** One user message, as the intake wrote it. */
function userRow(text: string): TranscriptRow {
  return { role: "user", content: text, responseData: null };
}

/** The answer a settled turn leaves in the session transcript. */
function answerRow(run: EnvelopeTurnRun): TranscriptRow {
  return { role: "assistant", content: run.store.succeeded[0]?.answer ?? "", responseData: null };
}

/** Three turns of one session against one Durable Object storage. Each turn
 * carries the steps of the ones before it, the way `loadRunningTurn` does. */
async function runThreeTurns(): Promise<EnvelopeTurnRun[]> {
  const storage = new RecordingEnvelopeStorage();
  const runs: EnvelopeTurnRun[] = [];
  const earlierSteps: RunSteps[] = [];
  let transcript: TranscriptRow[] = [userRow(`${PLACE}のあたりで${TITLE}の聖地は？`)];
  for (const [index, scripted] of [busyTurn, quietTurn, busyTurn].entries()) {
    const runId = `run-${String(index + 1)}`;
    const run = await runEnvelopeTurn({
      storage, runId, queued: [runId], transcript, earlierSteps: [...earlierSteps],
      resolveOutcome: WIDE_AMBIGUITY,
      streamFn: makeSequencedToolCallsStreamFn(scripted(runId)),
    });
    runs.push(run);
    earlierSteps.push({ runId, steps: run.store.steps });
    transcript = [...run.store.transcript, answerRow(run), userRow(`つづき ${String(index)}`)];
  }
  return runs;
}

/** The text of every tool return in one context — the only part the freeze
 * touches, and therefore the honest place to measure whether it shrank. */
function returnTextsIn(messages: readonly AgentMessage[]): string {
  return messages
    .flatMap((message) => ("role" in message && message.role === "toolResult" ? message.content : []))
    .flatMap((part) => (part.type === "text" ? part.text : []))
    .join("");
}

/** The same tool returns as the tools actually answered them, out of `run_steps`. */
function persistedReturnsOf(run: EnvelopeTurnRun): string {
  return run.store.steps
    .flatMap((step) => step.result?.content ?? [])
    .flatMap((part) => (part.type === "text" ? part.text : []))
    .join("");
}

function openingContextOf(run: EnvelopeTurnRun): readonly AgentMessage[] {
  return run.requests[0]?.messages ?? [];
}

/** One request's context WITHOUT the `<agent_status>` bar #1379 appends last —
 * the bar is rebuilt per request on purpose, so it is the one message expected
 * to differ. Everything under it is the history this card froze. */
function historyOf(request: ModelRequest | undefined): readonly AgentMessage[] {
  return (request?.messages ?? []).slice(0, -1);
}

/** Each request's history beside the one before it, cut to the same length:
 * within a turn pi only APPENDS, so the two must be the same string. */
function prefixPairsOf(run: EnvelopeTurnRun): { before: string; after: string }[] {
  return run.requests.slice(1).map((request, index) => {
    const earlier = historyOf(run.requests[index]);
    return {
      before: JSON.stringify(earlier),
      after: JSON.stringify(historyOf(request).slice(0, earlier.length)),
    };
  });
}

/** How many times one line is rendered into one status bar. */
function occurrencesIn(status: string, line: string): number {
  return status.split(line).length - 1;
}

/** The nth turn of the session, or a failure naming the turn that never ran. */
function turnAt(runs: readonly EnvelopeTurnRun[], index: number): EnvelopeTurnRun {
  const run = runs[index];
  if (run === undefined) throw new Error(`turn ${String(index + 1)} never ran`);
  return run;
}

void test("turn 3 opens with the pacing turn 1 planned with", async () => {
  const third = turnAt(await runThreeTurns(), 2);
  assert.match(third.statuses[0] ?? "", /User hard constraint: chill pacing\./);
});

void test("turn 3 opens with the title turn 1's freeze rescued", async () => {
  const third = turnAt(await runThreeTurns(), 2);
  assert.match(
    third.statuses[0] ?? "",
    /Verbatim entity retained from an earlier resolve_anime call: 「らき☆すた」/,
  );
});

void test("the fact survives the turn that recorded nothing at all", async () => {
  const second = turnAt(await runThreeTurns(), 1);
  assert.match(second.statuses[0] ?? "", /User hard constraint: chill pacing\./);
});

void test("turn 3 opens on turn 1's returns shrunk to their frozen summaries", async () => {
  const runs = await runThreeTurns();
  const replayed = returnTextsIn(openingContextOf(turnAt(runs, 2)));
  assert.ok(replayed.length < persistedReturnsOf(turnAt(runs, 0)).length, replayed);
});

void test("the frozen summary turn 3 replays keeps the candidate ids and drops the rest", async () => {
  const replayed = returnTextsIn(openingContextOf(turnAt(await runThreeTurns(), 2)));
  assert.match(replayed, /\[resolve_anime: ambiguous, ordered_candidates=/);
  assert.match(replayed, /90029/);
  assert.equal(replayed.includes("clarification_reason"), false);
});

void test("no message changes text between one model request of a turn and the next", async () => {
  const pairs = prefixPairsOf(turnAt(await runThreeTurns(), 2));
  assert.ok(pairs.length >= 5, "turn 3 made a request per tool call and one to answer");
  assert.deepEqual(pairs.map((pair) => pair.after), pairs.map((pair) => pair.before));
});

void test("the title is rescued once, however many turns replay the call", async () => {
  const third = turnAt(await runThreeTurns(), 2);
  const line = `Verbatim entity retained from an earlier resolve_anime call: 「${TITLE}」`;
  assert.equal(occurrencesIn(third.statuses[0] ?? "", line), 1);
});

void test("all three turns succeed", async () => {
  const runs = await runThreeTurns();
  assert.deepEqual(runs.map((run) => run.state.phase), ["succeeded", "succeeded", "succeeded"]);
});
