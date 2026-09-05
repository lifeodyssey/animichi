/**
 * W2-4 (#1290): three turns of one session, over the real pi loop.
 *
 * Only the whole round trip can answer this one. The claim is that a turn far
 * from where a fact was recorded still ACTS on it — the pacing turn 1 planned
 * with and the place name compaction rescued from turn 1's own history both
 * reach turn 3's model, through the Durable Object storage and the
 * `<agent_status>` bar (#1379), while the context that model is handed is
 * SMALLER than the raw transcript it was built from.
 *
 * Only the provider socket and the catalog binding are scripted; the loop, the
 * step persistence, the envelope staging and the compaction hook are the real
 * ones.
 *
 * test-type: integration (real pi loop + scripted provider/catalog, no network).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TranscriptRow } from "../src/agent/session/turn-store.ts";
import { makeSequencedToolCallsStreamFn, type ScriptedToolCall } from "./doubles/pi-provider-double.ts";
import { runEnvelopeTurn, type EnvelopeTurnRun } from "./doubles/make-envelope-turn.ts";
import { RecordingEnvelopeStorage } from "./doubles/recording-envelope-storage.ts";

const PLACE = "鷲宮神社";
const TITLE = "らき☆すた";

/**
 * Five tool calls, so the earliest of them falls out of the eight-message
 * retention window before the model's last request — which is what gives
 * compaction something to shrink and an entity to rescue. The first call is
 * `resolve_anime` on purpose: a wide disambiguation is the one catalog outcome
 * that is genuinely long, and it is also the one whose ordered candidate ids an
 * ordinal follow-up depends on, so it is the case worth measuring.
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

/** Three turns of one session against one Durable Object storage. */
async function runThreeTurns(): Promise<EnvelopeTurnRun[]> {
  const storage = new RecordingEnvelopeStorage();
  const runs: EnvelopeTurnRun[] = [];
  let transcript: TranscriptRow[] = [userRow(`${PLACE}のあたりで${TITLE}の聖地は？`)];
  for (const [index, scripted] of [busyTurn, quietTurn, busyTurn].entries()) {
    const runId = `run-${String(index + 1)}`;
    const run = await runEnvelopeTurn({
      storage, runId, queued: [runId], transcript,
      resolveOutcome: WIDE_AMBIGUITY,
      streamFn: makeSequencedToolCallsStreamFn(scripted(runId)),
    });
    runs.push(run);
    transcript = [...run.store.transcript, answerRow(run), userRow(`つづき ${String(index)}`)];
  }
  return runs;
}

/** The text of every tool return in one context — the only part compaction
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

function lastContextOf(run: EnvelopeTurnRun): readonly AgentMessage[] {
  return run.requests[run.requests.length - 1]?.messages ?? [];
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

void test("turn 3 opens with the title compaction rescued in turn 1", async () => {
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

/** 15 messages of history plus the one `<agent_status>` bar #1379 appends. */
void test("turn 3's last context is smaller than the raw transcript behind it", async () => {
  const third = turnAt(await runThreeTurns(), 2);
  assert.equal(lastContextOf(third).length, 16);
  assert.ok(returnTextsIn(lastContextOf(third)).length < persistedReturnsOf(third).length);
});

void test("turn 3's last context keeps the candidate ids and drops the rest", async () => {
  const returns = returnTextsIn(lastContextOf(turnAt(await runThreeTurns(), 2)));
  assert.match(returns, /\[resolve_anime: ambiguous, ordered_candidates=/);
  assert.match(returns, /90029/);
  assert.equal(returns.includes("clarification_reason"), false);
});

void test("all three turns succeed", async () => {
  const runs = await runThreeTurns();
  assert.deepEqual(runs.map((run) => run.state.phase), ["succeeded", "succeeded", "succeeded"]);
});
