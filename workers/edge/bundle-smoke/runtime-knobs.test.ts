/**
 * #688 AC2: the typed reader against a REAL KV binding in the Worker test
 * harness (Miniflare's workerd KV). A stored value flips the anonymous
 * admission decision within the reader's TTL with no redeploy, and deleting the
 * key restores the env default — the whole point of the knob store.
 *
 * The admission decisions are the production predicates: `allowanceExceeded`
 * for the message quota, and the dollar comparison `anonymousBudgetAvailable`
 * performs for the cost budget. The clock is a mutable number, so the TTL is
 * asserted exactly rather than by sleeping.
 *
 * test-type: integration (real KV storage in workerd; no network, no model).
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { createKnobReader } from "../src/config/runtime-knobs.ts";
import { RUNTIME_KNOBS } from "../src/config/edge-vars.ts";
import { allowanceExceeded } from "../src/agent/intake/anonymous-message-allowance.ts";

const TTL_MS = 1_000;
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('ok') } }",
  kvNamespaces: ["EDGE_KNOBS"],
});
after(() => mf.dispose());

void test("a stored quota flips the anonymous message admission decision within the TTL", async (context) => {
  const store = await mf.getKVNamespace("EDGE_KNOBS");
  const clock = { now: 0 };
  const reader = createKnobReader({ now: () => clock.now, ttlMs: TTL_MS });
  const env = { EDGE_KNOBS: store, ANON_DAILY_MESSAGE_QUOTA: "20" };
  const knob = RUNTIME_KNOBS.anonymousDailyMessageQuota;
  context.after(() => store.delete(knob.kvKey));

  assert.equal(allowanceExceeded(25, await reader.read(env, knob)), true, "the env default of 20 refuses the 26th message");

  await store.put(knob.kvKey, "30");
  clock.now += TTL_MS;
  assert.equal(allowanceExceeded(25, await reader.read(env, knob)), false, "the stored 30 admits the same reservation");

  await store.delete(knob.kvKey);
  clock.now += TTL_MS;
  assert.equal(allowanceExceeded(25, await reader.read(env, knob)), true, "deleting the key restores the env default");
});

void test("a stored budget flips the anonymous dollar admission threshold within the TTL", async (context) => {
  const store = await mf.getKVNamespace("EDGE_KNOBS");
  const clock = { now: 0 };
  const reader = createKnobReader({ now: () => clock.now, ttlMs: TTL_MS });
  const env = { EDGE_KNOBS: store, ANON_DAILY_COST_BUDGET_USD: "5.0" };
  const knob = RUNTIME_KNOBS.anonymousDailyCostBudgetUsd;
  context.after(() => store.delete(knob.kvKey));

  const spentUsd = 8;
  assert.equal(spentUsd < await reader.read(env, knob), false, "8 dollars exceeds the env default of 5");

  await store.put(knob.kvKey, "12.5");
  clock.now += TTL_MS;
  assert.equal(spentUsd < await reader.read(env, knob), true, "the stored 12.5 admits the same spend");

  await store.delete(knob.kvKey);
  clock.now += TTL_MS;
  assert.equal(spentUsd < await reader.read(env, knob), false, "deleting the key restores the env default");
});
