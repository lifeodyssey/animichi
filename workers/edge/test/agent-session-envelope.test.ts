/**
 * W1-7a (#1280): the session envelope as a value, and as a stored one.
 *
 * The two facts Python kept across turns (`agents/session_state.py`) are a value
 * object here, so a turn's state at any moment is one thing that can be written
 * down whole. These cases pin the transitions, the Durable Object round trip and
 * the trusted runtime context the next turn's model is given.
 *
 * test-type: unit (no clock, no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SessionEnvelope } from "../src/agent/session/session-envelope.ts";
import {
  DurableEnvelopeStore,
  SESSION_ENVELOPE_KEY,
} from "../src/agent/session/durable-envelope-store.ts";
import { TURN_SYSTEM_PROMPT, turnSystemPrompt } from "../src/agent/session/turn-instructions.ts";
import { RecordingEnvelopeStorage } from "./doubles/recording-envelope-storage.ts";
import type { OrderedCandidate } from "../src/agent/tools/catalog-tool-session.ts";

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
  assert.deepEqual(envelope.pendingClarification, { reason: "anime_ambiguity", candidates: CANDIDATES });
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
  await store.save(bothFacts());
  const loaded = await store.load();
  assert.deepEqual(loaded.currentAnime, HARUHI);
  assert.deepEqual(loaded.pendingClarification, { reason: "anime_ambiguity", candidates: CANDIDATES });
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
  await store.save(SessionEnvelope.empty.withClarification("place_ambiguity", [{ id: "kuki", title: "久喜駅" }]));
  const read = (await store.load()).pendingClarification;
  assert.deepEqual(read?.candidates, [{ id: "kuki", title: "久喜駅" }]);
});

void test("a turn with nothing stored runs the bare system prompt", () => {
  assert.equal(turnSystemPrompt(SessionEnvelope.empty), TURN_SYSTEM_PROMPT);
});

void test("the trusted runtime context names the anime the session already resolved", () => {
  const prompt = turnSystemPrompt(SessionEnvelope.empty.withAnime(HARUHI));
  assert.ok(prompt.startsWith(TURN_SYSTEM_PROMPT));
  assert.match(prompt, /涼宮ハルヒの憂鬱 \(485\)/u);
  assert.match(prompt, /already resolved/u);
});

void test("the trusted runtime context names the open question and its candidates", () => {
  const prompt = turnSystemPrompt(bothFacts());
  assert.match(prompt, /anime_ambiguity/u);
  assert.match(prompt, /485, 2907/u);
});
