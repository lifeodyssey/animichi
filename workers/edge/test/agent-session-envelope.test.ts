/**
 * W1-7a (#1280): the session envelope as a value, and as a stored one.
 *
 * The two facts Python kept across turns (`agents/session_state.py`) are a value
 * object here, so a turn's state at any moment is one thing that can be written
 * down whole. These cases pin the transitions and the Durable Object round trip;
 * what the next turn's model is TOLD of them is `agent-status.ts`' own suite
 * since #1379 (`agent-status-bar.test.ts`).
 *
 * test-type: unit (no clock, no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SessionEnvelope } from "../src/agent/session/session-envelope.ts";
import {
  DurableEnvelopeStore,
  SESSION_ENVELOPE_KEY,
  stagedEnvelopeKey,
} from "../src/agent/session/durable-envelope-store.ts";
import { RecordingEnvelopeStorage } from "./doubles/recording-envelope-storage.ts";
import type { OrderedCandidate } from "../src/agent/tools/catalog-tool-session.ts";

const RUN_ID = "run-1";
const HARUHI = { bangumiId: "485", title: "涼宮ハルヒの憂鬱" };
const CANDIDATES: OrderedCandidate[] = [
  { id: "485", title: "涼宮ハルヒの憂鬱", points_count: 12 },
  { id: "2907", title: "涼宮ハルヒの消失" },
];

/** An envelope carrying both facts, the way a turn that asked and resolved leaves one. */
function bothFacts(): SessionEnvelope {
  return SessionEnvelope.empty.withAnime(HARUHI).withClarification("anime_ambiguity", CANDIDATES);
}

void test("an empty envelope carries neither fact", () => {
  assert.equal(SessionEnvelope.empty.currentAnime, null);
  assert.equal(SessionEnvelope.empty.pendingClarification, null);
});

void test("recording a clarification leaves the resolved anime alone", () => {
  const envelope = bothFacts();
  assert.deepEqual(envelope.currentAnime, HARUHI);
  assert.deepEqual(envelope.pendingClarification, { id: 1, reason: "anime_ambiguity", candidates: CANDIDATES });
});

void test("clearing the clarification keeps the anime the session is about", () => {
  const cleared = bothFacts().cleared();
  assert.equal(cleared.pendingClarification, null);
  assert.deepEqual(cleared.currentAnime, HARUHI);
});

void test("a transition answers a new envelope and leaves the old one untouched", () => {
  const asked = SessionEnvelope.empty.withClarification("anime_ambiguity", CANDIDATES);
  assert.equal(SessionEnvelope.empty.pendingClarification, null);
  assert.equal(asked.cleared().pendingClarification, null);
  assert.deepEqual(asked.pendingClarification?.candidates, CANDIDATES);
});

void test("a saved envelope loads back with both facts", async () => {
  const storage = new RecordingEnvelopeStorage();
  const store = new DurableEnvelopeStore(storage);
  await store.stage(RUN_ID, bothFacts());
  await store.promote(RUN_ID);
  const loaded = await store.load();
  assert.deepEqual(loaded.currentAnime, HARUHI);
  assert.deepEqual(loaded.pendingClarification, { id: 1, reason: "anime_ambiguity", candidates: CANDIDATES });
});

void test("a session nothing has been written for loads the empty envelope", async () => {
  const loaded = await new DurableEnvelopeStore(new RecordingEnvelopeStorage()).load();
  assert.equal(loaded.currentAnime, null);
  assert.equal(loaded.pendingClarification, null);
});

/** The one failure a keyed store of our own values can actually have: an older
 * deployment wrote a shape this one no longer reads. It must read as absent
 * rather than as itself — a half-typed clarification handed to the next turn is
 * worse than no clarification at all. */
void test("a stored shape this deployment no longer reads loads as absent", async () => {
  const storage = new RecordingEnvelopeStorage();
  storage.seed(SESSION_ENVELOPE_KEY, {
    currentAnime: { bangumi_id: "485", title: "涼宮ハルヒの憂鬱" },
    pendingClarification: { reason: "anime_ambiguity", candidates: [{ id: 485 }] },
  });
  const loaded = await new DurableEnvelopeStore(storage).load();
  assert.equal(loaded.currentAnime, null);
  assert.equal(loaded.pendingClarification, null);
});

/** The optional half of a candidate is checked too, so the assertion the adapter
 * makes about the rest of the shape is earned rather than assumed. */
void test("a stored candidate whose optional field has the wrong type is not read back", async () => {
  const storage = new RecordingEnvelopeStorage();
  storage.seed(SESSION_ENVELOPE_KEY, {
    currentAnime: null,
    pendingClarification: {
      reason: "anime_ambiguity",
      candidates: [{ id: "485", title: "涼宮ハルヒの憂鬱", points_count: "twelve" }],
    },
  });
  assert.equal((await new DurableEnvelopeStore(storage).load()).pendingClarification, null);
});

void test("a stored candidate carrying no optional fields at all is read back whole", async () => {
  const storage = new RecordingEnvelopeStorage();
  const store = new DurableEnvelopeStore(storage);
  await store.stage(RUN_ID, SessionEnvelope.empty.withClarification("place_ambiguity", [{ id: "kuki", title: "久喜駅" }]));
  await store.promote(RUN_ID);
  const read = (await store.load()).pendingClarification;
  assert.deepEqual(read?.candidates, [{ id: "kuki", title: "久喜駅" }]);
});

/** Promotion is the half that runs on a retry, so running it twice has to be
 * indistinguishable from running it once — no second envelope write, and no
 * staging left behind to be promoted a third time. */
void test("promoting the same run twice writes one envelope and leaves no staging", async () => {
  const storage = new RecordingEnvelopeStorage();
  const store = new DurableEnvelopeStore(storage);
  await store.stage(RUN_ID, SessionEnvelope.empty.withAnime(HARUHI));
  await store.promote(RUN_ID);
  await store.promote(RUN_ID);
  assert.equal(storage.envelopeWrites.length, 1);
  assert.deepEqual(storage.keys, [SESSION_ENVELOPE_KEY]);
  assert.deepEqual((await store.load()).currentAnime, HARUHI);
});

void test("a run with nothing staged promotes nothing at all", async () => {
  const storage = new RecordingEnvelopeStorage();
  await new DurableEnvelopeStore(storage).promote(RUN_ID);
  assert.deepEqual(storage.writes, []);
});

/** Two runs of one session stage under their own keys, so neither can promote
 * the other's answer. */
void test("one run's staging is not visible to another run's promotion", async () => {
  const storage = new RecordingEnvelopeStorage();
  const store = new DurableEnvelopeStore(storage);
  await store.stage(RUN_ID, SessionEnvelope.empty.withAnime(HARUHI));
  await store.promote("run-2");
  assert.deepEqual(storage.envelopeWrites, []);
  assert.deepEqual(storage.keys, [stagedEnvelopeKey(RUN_ID)]);
});
