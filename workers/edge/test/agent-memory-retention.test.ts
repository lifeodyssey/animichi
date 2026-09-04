/**
 * W2-4 (#1290): the compaction-retained entity ledger, and both ledgers'
 * Durable Object round trip.
 *
 * The eviction order is the case that matters. Python chose OLDEST-WINS here
 * rather than FIFO because the entities worth rescuing are the deepest ones —
 * a near-tail entity dropped from this ledger is still in the raw transcript,
 * while a first-turn entity evicted from it is gone for good — so a full ledger
 * drops the NEWER distinct entity.
 *
 * test-type: unit (no clock, no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ENTITY_VALUE_BYTES,
  MAX_RETAINED_ENTITIES,
  RetainedEntityLedger,
} from "../src/agent/memory/retained-entity-ledger.ts";
import { FactLedger } from "../src/agent/memory/fact-ledger.ts";
import { encodedMemory, storedMemory } from "../src/agent/memory/stored-memory.ts";
import { SessionEnvelope } from "../src/agent/session/session-envelope.ts";
import { DurableEnvelopeStore } from "../src/agent/session/durable-envelope-store.ts";
import { RecordingEnvelopeStorage } from "./doubles/recording-envelope-storage.ts";

const NOW = new Date("2026-09-02T00:00:00.000Z");
const RUN_ID = "run-1";

/** A ledger holding `count` distinct place names, oldest first. */
function makeFullLedger(count = MAX_RETAINED_ENTITIES): RetainedEntityLedger {
  return Array.from({ length: count }).reduce<RetainedEntityLedger>(
    (held, _unused, index) => held.record("search_nearby", `place-${String(index)}`),
    RetainedEntityLedger.empty,
  );
}

void test("an empty ledger has retained nothing", () => {
  assert.equal(RetainedEntityLedger.empty.isEmpty, true);
  assert.deepEqual(RetainedEntityLedger.empty.entities, []);
});

void test("a blank value after sanitization retains nothing", () => {
  assert.equal(RetainedEntityLedger.empty.record("search_nearby", "  \n ").isEmpty, true);
});

void test("a repeat moves to the tail instead of duplicating", () => {
  const ledger = RetainedEntityLedger.empty
    .record("resolve_anime", "らき☆すた")
    .record("search_nearby", "鷲宮")
    .record("resolve_anime", "らき☆すた");
  assert.deepEqual(ledger.entities.map((entity) => entity.value), ["鷲宮", "らき☆すた"]);
});

void test("a full ledger drops the NEWER entity and keeps the oldest", () => {
  const full = makeFullLedger().record("search_nearby", "newest-place");
  assert.equal(full.entities.length, MAX_RETAINED_ENTITIES);
  assert.equal(full.entities[0]?.value, "place-0");
  assert.deepEqual(full.entities.map((entity) => entity.value).includes("newest-place"), false);
});

void test("a full ledger still moves a repeat of an entity it already holds", () => {
  const full = makeFullLedger().record("search_nearby", "place-0");
  assert.equal(full.entities.length, MAX_RETAINED_ENTITIES);
  assert.equal(full.entities[MAX_RETAINED_ENTITIES - 1]?.value, "place-0");
});

void test("a long CJK value is cut on the byte budget", () => {
  const [entity] = RetainedEntityLedger.empty.record("search_nearby", "資".repeat(40)).entities;
  assert.ok(new TextEncoder().encode(entity?.value ?? "").length <= MAX_ENTITY_VALUE_BYTES);
});

void test("a stored ledger over the cap is trimmed to its oldest entries on restore", () => {
  const oversized = Array.from({ length: MAX_RETAINED_ENTITIES + 4 }, (_unused, index) => ({
    toolName: "search_nearby",
    value: `place-${String(index)}`,
  }));
  const restored = RetainedEntityLedger.restored(oversized);
  assert.equal(restored.entities.length, MAX_RETAINED_ENTITIES);
  assert.equal(restored.entities[0]?.value, "place-0");
});

void test("a stored fact record missing a field is dropped, not trusted", () => {
  const read = storedMemory({
    facts: { hardConstraints: [{ id: "a", value: "chill" }], sceneReferences: [] },
    retainedEntities: [{ toolName: "search_nearby" }],
  });
  assert.equal(read.facts.isEmpty, true);
  assert.equal(read.retainedEntities.isEmpty, true);
});

void test("a stored pacing outside the vocabulary is dropped", () => {
  const read = storedMemory(encodedMemory({
    facts: FactLedger.empty,
    retainedEntities: RetainedEntityLedger.empty,
  }));
  assert.equal(read.facts.isEmpty, true);
  const forged = storedMemory({
    facts: {
      hardConstraints: [
        { id: "a", value: "sprint", recordedAt: NOW.toISOString(), supersededBy: null },
      ],
      sceneReferences: [],
    },
  });
  assert.equal(forged.facts.isEmpty, true);
});

void test("both ledgers survive the Durable Object round trip", async () => {
  const storage = new RecordingEnvelopeStorage();
  const store = new DurableEnvelopeStore(storage);
  const envelope = SessionEnvelope.empty.remembering({
    facts: FactLedger.empty.appendHardConstraint("packed", NOW),
    retainedEntities: RetainedEntityLedger.empty.record("search_nearby", "鷲宮"),
  });

  await store.stage(RUN_ID, envelope);
  await store.promote(RUN_ID);
  const loaded = await store.load();

  assert.equal(loaded.memory.facts.activeHardConstraint()?.value, "packed");
  assert.deepEqual(loaded.memory.retainedEntities.entities, [
    { toolName: "search_nearby", value: "鷲宮" },
  ]);
});
