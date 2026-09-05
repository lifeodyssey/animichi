/**
 * W2 (#1379, spec §九 9.3/9.4): where the `<agent_status>` bar sits, over the
 * real pi loop.
 *
 * Only the whole round trip can answer these. "The context ENDS with the bar"
 * is a claim about what `transformContext` hands the provider; "there is only
 * ever ONE" is a claim about a turn that makes several requests; "the model
 * never sees a stale bar" is a claim about a tool that rewrote the envelope
 * between two of them; and "the system prompt is byte-identical across turns"
 * is the acceptance anchor of spec §九 9.4, which needs two settled turns of
 * one session. Only the provider socket and the catalog binding are scripted.
 *
 * test-type: integration (real pi loop + scripted provider/catalog, no network).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TURN_SYSTEM_PROMPT } from "../src/agent/session/turn-instructions.ts";
import {
  AMBIGUOUS_LUCKY_STAR,
  lastMessageIn,
  runEnvelopeTurn,
  statusBarsIn,
  type EnvelopeTurnRun,
  type ModelRequest,
} from "./doubles/make-envelope-turn.ts";
import { makeSequencedToolCallsStreamFn } from "./doubles/pi-provider-double.ts";
import { RecordingEnvelopeStorage } from "./doubles/recording-envelope-storage.ts";

const RESOLVE_CALL = { name: "resolve_anime", arguments: { title: "らき☆すた" } };
const NEARBY_CALL = { name: "search_nearby", arguments: { location: "久喜駅" } };

/** A turn that resolves the work, then searches around a place: three model
 * requests, and an envelope the first tool rewrites. */
function busyTurn(storage: RecordingEnvelopeStorage) {
  return runEnvelopeTurn({
    storage,
    streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL, NEARBY_CALL]),
  });
}

/** The nth request of a turn, or a failure naming the one that never happened. */
function requestAt(run: EnvelopeTurnRun, index: number): ModelRequest {
  const request = run.requests[index];
  if (request === undefined) throw new Error(`request ${String(index + 1)} was never made`);
  return request;
}

/** Everything this turn actually wrote down: the rows, the steps and the answer. */
function persistedBy(run: EnvelopeTurnRun): string {
  return JSON.stringify([run.store.transcript, run.store.steps, run.store.succeeded]);
}

void test("the context the model is handed ends with the status bar", async () => {
  const run = await busyTurn(new RecordingEnvelopeStorage());
  assert.ok(lastMessageIn(requestAt(run, 1)).startsWith("<agent_status>"));
  assert.ok(lastMessageIn(requestAt(run, 2)).startsWith("<agent_status>"));
});

void test("no request ever carries two status bars", async () => {
  const run = await busyTurn(new RecordingEnvelopeStorage());
  assert.deepEqual(run.requests.map((request) => statusBarsIn(request).length), [0, 1, 1]);
});

/** The first request of a fresh session has nothing to vouch for: an empty bar
 * would spend tokens and attention saying so. */
void test("a session that has done nothing yet is handed no bar", async () => {
  const run = await busyTurn(new RecordingEnvelopeStorage());
  assert.deepEqual(statusBarsIn(requestAt(run, 0)), []);
});

/** The bar is rendered per request, so a tool that resolved the anime between
 * two of them is on the second one — never one request late. */
void test("the bar follows the tools within the turn", async () => {
  const run = await busyTurn(new RecordingEnvelopeStorage());
  assert.match(lastMessageIn(requestAt(run, 1)), /Current anime: らき☆すた \(1\)\./u);
  assert.match(lastMessageIn(requestAt(run, 1)), /Tool calls this turn: resolve_anime ×1\./u);
  assert.match(lastMessageIn(requestAt(run, 2)), /resolve_anime ×1, search_nearby ×1\./u);
});

/** It is context, not history: `transformContext` shapes what one request
 * carries and nothing else, so nothing in Neon has ever seen a bar. */
void test("the bar is never written to the transcript, the steps or the answer", async () => {
  const run = await busyTurn(new RecordingEnvelopeStorage());
  assert.equal(persistedBy(run).includes("agent_status"), false);
});

/**
 * The acceptance anchor of spec §九 9.4. Turn 1 resolves the work and turn 2
 * opens a clarification, so the envelope the model is given differs in every
 * field between them — and the prompt does not differ at all.
 */
void test("turn 2 runs the same system prompt bytes as turn 1", async () => {
  const storage = new RecordingEnvelopeStorage();
  const first = await runEnvelopeTurn({ storage, streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL]) });
  const second = await runEnvelopeTurn({
    storage, runId: "run-2", queued: ["run-2"],
    resolveOutcome: AMBIGUOUS_LUCKY_STAR,
    streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL]),
  });
  assert.equal(requestAt(second, 0).prompt, requestAt(first, 0).prompt);
  assert.equal(requestAt(second, 0).prompt, TURN_SYSTEM_PROMPT);
});

/** Two sessions with the same model and tool set share the prompt too — which
 * is what makes the cached prefix worth anything across users. */
void test("a second session's first turn runs those same bytes", async () => {
  const first = await busyTurn(new RecordingEnvelopeStorage());
  const other = await busyTurn(new RecordingEnvelopeStorage());
  assert.equal(requestAt(other, 0).prompt, requestAt(first, 0).prompt);
});

/** What turn 1 resolved reaches turn 2's model — on the bar now, not in the
 * prompt. The carry-forward itself is what #1280 earned; this pins where it
 * arrives. */
void test("what turn 1 resolved is on turn 2's first bar", async () => {
  const storage = new RecordingEnvelopeStorage();
  await runEnvelopeTurn({ storage, streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL]) });
  const second = await runEnvelopeTurn({
    storage, runId: "run-2", queued: ["run-2"],
    streamFn: makeSequencedToolCallsStreamFn([NEARBY_CALL]),
  });
  assert.match(lastMessageIn(requestAt(second, 0)), /Current anime: らき☆すた \(1\)\./u);
});
