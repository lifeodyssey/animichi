/**
 * W1-7a (#1280, PR #1282 review): a staging must never outlive a newer answer.
 *
 * Two ways it could, both found on the same review, both about the fact that a
 * run whose promotion failed stays QUEUED while its `runs` row is already
 * terminal — a state in which a second run of the same session can be admitted:
 *   (A) the newer run reads the old envelope and publishes over the staging,
 *       which the older run's retry then publishes back over. Fixed by draining
 *       every OTHER queued run's staging before a turn reads the envelope.
 *   (B) a contender that merely lost the lease publishes the live owner's
 *       staging before that owner's own Neon commit. Fixed by giving "the run is
 *       already terminal" its own phase, so only that one promotes.
 *
 * test-type: unit (fake clock; no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DurableEnvelopeStore,
  SESSION_ENVELOPE_KEY,
  stagedEnvelopeKey,
} from "../src/agent/session/durable-envelope-store.ts";
import { SessionEnvelope } from "../src/agent/session/session-envelope.ts";
import { RecordingEnvelopeStorage } from "./doubles/recording-envelope-storage.ts";
import {
  AMBIGUOUS_LUCKY_STAR,
  makeEnvelopeTurnStore,
  runEnvelopeTurn,
  RUN_ID,
} from "./doubles/make-envelope-turn.ts";
import { makeSequencedToolCallsStreamFn } from "./doubles/pi-provider-double.ts";

const RUN_TWO = "run-2";
const RESOLVE_CALL = { name: "resolve_anime", arguments: { title: "らき☆すた" } };
const LUCKY_STAR = { bangumiId: "1", title: "らき☆すた" };

function storedEnvelope(storage: RecordingEnvelopeStorage) {
  return new DurableEnvelopeStore(storage).load();
}

/** Run one turn that settles and then cannot publish: the `runs` row is terminal
 * and the answer exists only as a staging under that run's key. */
function firstRunStrandsItsAnswer(storage: RecordingEnvelopeStorage, store: ReturnType<typeof makeEnvelopeTurnStore>) {
  storage.failNextWriteTo = SESSION_ENVELOPE_KEY;
  return assert.rejects(() => runEnvelopeTurn({
    storage, store, runId: RUN_ID, queued: [RUN_ID],
    streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL]),
  }));
}

void test("a newer run opens from the staging an older run could not publish", async () => {
  const storage = new RecordingEnvelopeStorage();
  await firstRunStrandsItsAnswer(storage, makeEnvelopeTurnStore({ runId: RUN_ID }));
  assert.equal((await storedEnvelope(storage)).currentAnime, null);

  const second = await runEnvelopeTurn({
    storage, runId: RUN_TWO, queued: [RUN_ID, RUN_TWO],
    store: makeEnvelopeTurnStore({ runId: RUN_TWO }),
    streamFn: makeSequencedToolCallsStreamFn([]),
  });
  assert.match(second.prompts[0] ?? "", /らき☆すた \(1\)/u);
});

/** The whole point of the drain: after the newer run has published its own
 * answer, the older run's retry must have nothing left to publish over it. */
void test("the older run's retry cannot publish its staging over the newer answer", async () => {
  const storage = new RecordingEnvelopeStorage();
  const first = makeEnvelopeTurnStore({ runId: RUN_ID });
  await firstRunStrandsItsAnswer(storage, first);

  await runEnvelopeTurn({
    storage, runId: RUN_TWO, queued: [RUN_ID, RUN_TWO],
    store: makeEnvelopeTurnStore({ runId: RUN_TWO }),
    resolveOutcome: AMBIGUOUS_LUCKY_STAR,
    streamFn: makeSequencedToolCallsStreamFn([RESOLVE_CALL]),
  });
  const retry = await runEnvelopeTurn({
    storage, store: first, runId: RUN_ID, queued: [RUN_ID],
    streamFn: makeSequencedToolCallsStreamFn([]),
  });

  assert.equal(retry.state.phase, "already_settled");
  const final = await storedEnvelope(storage);
  assert.equal(final.pendingClarification?.reason, "anime_ambiguity");
  assert.deepEqual(final.currentAnime, LUCKY_STAR);
});

/** (B): the owner staged moments before its own Neon commit. A contender that
 * lost the lease must leave both the envelope and that staging alone. */
void test("a turn that lost the lease to a live owner publishes nothing", async () => {
  const storage = new RecordingEnvelopeStorage();
  await new DurableEnvelopeStore(storage).stage(RUN_ID, SessionEnvelope.empty.withAnime(LUCKY_STAR));
  const contender = await runEnvelopeTurn({
    storage, leaseOwner: "do-2", runId: RUN_ID, queued: [RUN_ID],
    streamFn: makeSequencedToolCallsStreamFn([]),
  });

  assert.equal(contender.state.phase, "declined");
  assert.deepEqual(storage.envelopeWrites, []);
  assert.deepEqual(storage.keys, [stagedEnvelopeKey(RUN_ID)]);
});
