/**
 * W1-7a (#1280): when the session envelope is written, and when it is not.
 *
 * The rule under test is one sentence: the envelope is settled WITH the run, by
 * the incarnation that settled it, exactly once. Everything else follows —
 * a failed turn still banks what its tools recorded, a turn that could not write
 * its step banks nothing and leaves the previous envelope for the retry, a turn
 * another owner is running writes nothing at all, and a replayed step (which
 * never calls `execute`) cannot apply anything a second time.
 *
 * test-type: unit (fake clock; no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DurableEnvelopeStore,
  SESSION_ENVELOPE_KEY,
} from "../src/agent/session/durable-envelope-store.ts";
import { RecordingEnvelopeStorage } from "./doubles/recording-envelope-storage.ts";
import { makeEnvelopeTurnStore, runEnvelopeTurn } from "./doubles/make-envelope-turn.ts";
import {
  makeSequencedToolCallsStreamFn,
  makeToolResultRejectingStreamFn,
} from "./doubles/pi-provider-double.ts";

const RESOLVE_CALL = { name: "resolve_anime", arguments: { title: "らき☆すた" } };
const SEARCH_CALL = { name: "search_bangumi", arguments: { bangumi_id: "1" } };
const LUCKY_STAR = { bangumiId: "1", title: "らき☆すた" };

/** The step a first attempt settled before it lost the turn: `resolve_anime`
 * answered and its row is in `run_steps`, so the retry REPLAYS it. */
const SETTLED_RESOLVE = {
  stepIndex: 0,
  toolName: "resolve_anime",
  input: { title: "らき☆すた" },
  result: { content: [{ type: "text" as const, text: "resolved" }], details: { outcome: "resolved" } },
};

function storedEnvelope(storage: RecordingEnvelopeStorage) {
  return new DurableEnvelopeStore(storage).load();
}

void test("a turn that succeeded banks what its tools recorded, in one write", async () => {
  const storage = new RecordingEnvelopeStorage();
  const run = await runEnvelopeTurn({
    storage,
    streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL, SEARCH_CALL]),
  });
  assert.equal(run.state.phase, "succeeded");
  assert.equal(storage.envelopeWrites.length, 1);
  assert.deepEqual((await storedEnvelope(storage)).currentAnime, LUCKY_STAR);
});

/** SD-18's rule, ported: a turn that ended in a failure still knows what its
 * tools learned, and the retry needs it rather than a wiped envelope. */
void test("a turn that failed still banks what its tools recorded", async () => {
  const storage = new RecordingEnvelopeStorage();
  const run = await runEnvelopeTurn({
    storage,
    streamFn: makeToolResultRejectingStreamFn("400 bad request"),
  });
  assert.deepEqual(run.state, { phase: "failed", reason: "provider_failed" });
  assert.equal(storage.envelopeWrites.length, 1);
});

void test("a turn whose step could not be written leaves the previous envelope alone", async () => {
  const storage = new RecordingEnvelopeStorage();
  await runEnvelopeTurn({ storage, streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL]) });
  await assert.rejects(() => runEnvelopeTurn({
    storage,
    stepWritesFail: true,
    streamFn: makeSequencedToolCallsStreamFn([SEARCH_CALL]),
  }));
  assert.equal(storage.envelopeWrites.length, 1);
  assert.deepEqual((await storedEnvelope(storage)).currentAnime, LUCKY_STAR);
});

/** A run another incarnation holds settles nothing here, and that has to include
 * the envelope: the owner that writes the terminal row owns the envelope too,
 * and a second writer would race it. */
void test("a turn declined to its live owner writes no envelope", async () => {
  const storage = new RecordingEnvelopeStorage();
  const run = await runEnvelopeTurn({
    storage,
    leaseOwner: "do-2",
    streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL]),
  });
  assert.equal(run.state.phase, "declined");
  assert.deepEqual(storage.writes, []);
});

/** The replay branch: step 0 is answered from `run_steps` without calling
 * `execute`, so nothing the first attempt applied is applied again — and the
 * whole envelope is written as one value, so a second write could not add to it
 * even if one happened. */
void test("a retry that replays a settled step writes the envelope once more, not twice", async () => {
  const storage = new RecordingEnvelopeStorage();
  const run = await runEnvelopeTurn({
    storage,
    steps: [SETTLED_RESOLVE],
    streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL, SEARCH_CALL]),
  });
  assert.equal(run.state.phase, "succeeded");
  assert.deepEqual(run.store.written.map((step) => step.toolName), ["search_bangumi"]);
  assert.equal(storage.envelopeWrites.length, 1);
});

/**
 * The crash this whole staging/promotion split exists for (PR #1282): the run's
 * terminal row is committed in Neon and the envelope write then refuses. The
 * alarm throws before it dequeues, so the platform retries — and the retry finds
 * the run already terminal, which used to mean the turn's envelope was simply
 * lost. It is now waiting under the run's own key.
 */
void test("an envelope write that failed after settlement is completed by the retry", async () => {
  const storage = new RecordingEnvelopeStorage();
  const store = makeEnvelopeTurnStore();
  storage.failNextWriteTo = SESSION_ENVELOPE_KEY;
  await assert.rejects(() => runEnvelopeTurn({
    storage, store, streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL]),
  }));
  assert.equal(store.succeeded.length, 1);
  assert.deepEqual((await storedEnvelope(storage)).currentAnime, null);

  const retry = await runEnvelopeTurn({ storage, store, streamFn: makeSequencedToolCallsStreamFn([]) });
  assert.equal(retry.state.phase, "declined");
  assert.deepEqual((await storedEnvelope(storage)).currentAnime, LUCKY_STAR);
});

/** The other half of that rule: an alarm that comes back to a run whose envelope
 * already landed has nothing to promote, and must not write over the session. */
void test("a retry of a terminal run with nothing staged writes nothing", async () => {
  const storage = new RecordingEnvelopeStorage();
  const store = makeEnvelopeTurnStore();
  await runEnvelopeTurn({ storage, store, streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL]) });
  const banked = storage.envelopeWrites.length;

  const retry = await runEnvelopeTurn({ storage, store, streamFn: makeSequencedToolCallsStreamFn([]) });
  assert.equal(retry.state.phase, "declined");
  assert.equal(storage.envelopeWrites.length, banked);
  assert.deepEqual(storage.keys, [SESSION_ENVELOPE_KEY]);
});
