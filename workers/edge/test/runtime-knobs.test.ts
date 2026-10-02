/**
 * #688 AC1/AC3: the typed knob reader. Every branch the store can take —
 * a valid value, an absent key, a malformed value, a throwing read, no binding
 * at all — resolves to a value, and a deploy-coupled gate can never be a knob.
 *
 * The clock is a mutable number, never `Date.now`, so the TTL bound is asserted
 * exactly rather than by sleeping.
 *
 * test-type: unit (pure reader + an in-memory store; no clock of its own).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createKnobReader,
  runtimeKnob,
  DEPLOY_COUPLED_VARS,
  type KnobStore,
} from "../src/config/runtime-knobs.ts";
import { RUNTIME_KNOBS } from "../src/config/edge-vars.ts";
import { EDGE_VARS } from "../src/config/edge-var-inventory.ts";

const quota = RUNTIME_KNOBS.anonymousDailyMessageQuota;
const budget = RUNTIME_KNOBS.anonymousDailyCostBudgetUsd;
const TTL_MS = 1_000;

function readerAt(clock: { now: number }) {
  return createKnobReader({ now: () => clock.now, ttlMs: TTL_MS });
}

function storeReturning(value: string | null): KnobStore {
  return { get: () => Promise.resolve(value) };
}

function envWith(store: KnobStore | undefined, quotaValue = "20") {
  return { EDGE_KNOBS: store, ANON_DAILY_MESSAGE_QUOTA: quotaValue, ANON_DAILY_COST_BUDGET_USD: "5.0" };
}

void test("a valid stored value wins over the env fallback", async () => {
  const clock = { now: 0 };
  const env = envWith(storeReturning("30"));
  assert.equal(await readerAt(clock).read(env, quota), 30);
});

void test("an absent key falls back to the env value", async () => {
  const clock = { now: 0 };
  const env = envWith(storeReturning(null));
  assert.equal(await readerAt(clock).read(env, quota), 20);
});

void test("a malformed stored value falls back to the env value", async () => {
  const clock = { now: 0 };
  const env = envWith(storeReturning("twenty"));
  assert.equal(await readerAt(clock).read(env, quota), 20);
});

void test("a malformed stored budget falls back to the env budget", async () => {
  const clock = { now: 0 };
  const env = envWith(storeReturning("twenty"));
  assert.equal(await readerAt(clock).read(env, budget), 5);
});

void test("a throwing store falls back to the env value", async () => {
  const clock = { now: 0 };
  const env = envWith({ get: () => Promise.reject(new Error("kv unreachable")) });
  assert.equal(await readerAt(clock).read(env, quota), 20);
});

void test("an unbound store falls back to the env value", async () => {
  const clock = { now: 0 };
  assert.equal(await readerAt(clock).read(envWith(undefined), quota), 20);
});

void test("the cache serves the first resolution for exactly the TTL, then re-reads", async () => {
  const clock = { now: 0 };
  const stored = new Map<string, string>([[quota.kvKey, "30"]]);
  const env = envWith({ get: (key) => Promise.resolve(stored.get(key) ?? null) });
  const reader = readerAt(clock);

  assert.equal(await reader.read(env, quota), 30);
  stored.set(quota.kvKey, "40");
  clock.now = TTL_MS - 1;
  assert.equal(await reader.read(env, quota), 30, "inside the TTL the first resolution stands");
  clock.now = TTL_MS;
  assert.equal(await reader.read(env, quota), 40, "at the TTL the store is read again");
});

void test("the store is read with KV's 30-second minimum edge cache TTL", async () => {
  const clock = { now: 0 };
  const reads: unknown[] = [];
  const env = envWith({
    get: (_key, options) => {
      reads.push(options);
      return Promise.resolve("30");
    },
  });
  await readerAt(clock).read(env, quota);
  assert.deepEqual(reads, [{ cacheTtl: 30 }]);
});

void test("the env fallback keeps the budget's unset default and the quota's 0-disables convention", async () => {
  const clock = { now: 0 };
  const env = { ANON_DAILY_MESSAGE_QUOTA: "0" };
  assert.equal(await readerAt(clock).read(env, budget), 5);
  assert.equal(await readerAt(clock).read(env, quota), 0);
});

void test("a stored 0 disables the quota instead of falling back to the env value", async () => {
  const clock = { now: 0 };
  const env = envWith(storeReturning("0"), "20");
  assert.equal(await readerAt(clock).read(env, quota), 0);
});

void test("every var the inventory classifies deploy-coupled is refused at knob construction", () => {
  const coupled = EDGE_VARS.filter((entry) => entry.class === "deploy-coupled").map((entry) => entry.name);
  for (const name of coupled) {
    assert.throws(
      () => runtimeKnob({ envVar: name, kvKey: `knob:${name}`, parse: Number, fromEnv: () => 0 }),
      new RegExp(`${name} is deploy-coupled`),
    );
  }
});

void test("no registered knob reads a deploy-coupled gate", () => {
  const readable = Object.values(RUNTIME_KNOBS).map((knob) => knob.envVar);
  assert.deepEqual(readable.filter((name) => DEPLOY_COUPLED_VARS.has(name)), []);
});
