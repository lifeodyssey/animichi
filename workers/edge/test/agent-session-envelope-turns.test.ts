/**
 * W1-7a (#1280): what one turn leaves behind, and what the next one is given
 * — on the `<agent_status>` bar since #1379, no longer in the system prompt.
 *
 * Driven over the REAL pi loop, the real `TurnSteps` persistence and the real
 * catalog tools, because "turn N+1" only means something if turn N actually
 * ended: the tools have to have run, the steps have to have been written and
 * the envelope has to have been settled with the run. Only the provider socket
 * and the `CATALOG` binding are scripted.
 *
 * test-type: unit (fake clock; no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DurableEnvelopeStore } from "../src/agent/session/durable-envelope-store.ts";
import { RecordingEnvelopeStorage } from "./doubles/recording-envelope-storage.ts";
import { AMBIGUOUS_LUCKY_STAR, runEnvelopeTurn } from "./doubles/make-envelope-turn.ts";
import { makeSequencedToolCallsStreamFn } from "./doubles/pi-provider-double.ts";

const RESOLVE_CALL = { name: "resolve_anime", arguments: { title: "らき☆すた" } };
const SEARCH_CALL = { name: "search_bangumi", arguments: { bangumi_id: "1" } };
const NEARBY_CALL = { name: "search_nearby", arguments: { location: "久喜駅" } };

/** What the session carries between turns, read back the way the next turn reads it. */
function storedEnvelope(storage: RecordingEnvelopeStorage) {
  return new DurableEnvelopeStore(storage).load();
}

/** Turn N: the catalog cannot decide, so the turn ends holding a question. */
function askedTurn(storage: RecordingEnvelopeStorage) {
  return runEnvelopeTurn({
    storage,
    resolveOutcome: AMBIGUOUS_LUCKY_STAR,
    streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL]),
  });
}

/** Turn N: the catalog names one work, so the session is about it from now on. */
function resolvedTurn(storage: RecordingEnvelopeStorage) {
  return runEnvelopeTurn({ storage, streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL]) });
}

void test("a question one turn asked is still open for the turn after it", async () => {
  const storage = new RecordingEnvelopeStorage();
  await askedTurn(storage);
  await runEnvelopeTurn({ storage, streamFn: makeSequencedToolCallsStreamFn([]) });
  const carried = (await storedEnvelope(storage)).pendingClarification;
  assert.ok(carried);
  assert.equal(carried.reason, "anime_ambiguity");
  assert.deepEqual(carried.candidates.map((one) => one.id), ["1", "2"]);
});

void test("the next turn's model is told which question is open, and about what", async () => {
  const storage = new RecordingEnvelopeStorage();
  await askedTurn(storage);
  const next = await runEnvelopeTurn({ storage, streamFn: makeSequencedToolCallsStreamFn([]) });
  assert.match(next.statuses[0] ?? "", /anime_ambiguity/u);
  assert.match(next.statuses[0] ?? "", /1, 2/u);
});

void test("a tool that answers the question closes it for the turn after that", async () => {
  const storage = new RecordingEnvelopeStorage();
  await askedTurn(storage);
  await runEnvelopeTurn({ storage, streamFn: makeSequencedToolCallsStreamFn([SEARCH_CALL]) });
  assert.equal((await storedEnvelope(storage)).pendingClarification, null);
});

void test("the anime one turn resolved is named on the next turn's status bar", async () => {
  const storage = new RecordingEnvelopeStorage();
  await resolvedTurn(storage);
  assert.deepEqual((await storedEnvelope(storage)).currentAnime, { bangumiId: "1", title: "らき☆すた" });
  const next = await runEnvelopeTurn({ storage, streamFn: makeSequencedToolCallsStreamFn([NEARBY_CALL]) });
  assert.match(next.statuses[0] ?? "", /らき☆すた \(1\)/u);
});

void test("with the anime already resolved the next turn searches without resolving again", async () => {
  const storage = new RecordingEnvelopeStorage();
  await resolvedTurn(storage);
  const next = await runEnvelopeTurn({ storage, streamFn: makeSequencedToolCallsStreamFn([NEARBY_CALL]) });
  assert.deepEqual(next.store.written.map((step) => step.toolName), ["search_nearby"]);
  assert.deepEqual((await storedEnvelope(storage)).currentAnime, { bangumiId: "1", title: "らき☆すた" });
});

/** `search_nearby` clears the question it could not have been asked about, which
 * is the Python behaviour (`catalog_tools.py`): a tool that produced rows has
 * answered, so nothing is left pending for the turn after it. */
void test("a search around a place closes any question the session was holding", async () => {
  const storage = new RecordingEnvelopeStorage();
  await askedTurn(storage);
  await runEnvelopeTurn({ storage, streamFn: makeSequencedToolCallsStreamFn([NEARBY_CALL]) });
  assert.equal((await storedEnvelope(storage)).pendingClarification, null);
});
