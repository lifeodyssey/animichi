import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { catalogClock, settledWithin } from "./catalog-clock.ts";

void test("an event that arrives is returned unchanged", async () => {
  assert.equal(await settledWithin(Promise.resolve("settled"), "the healthy event", 5), "settled");
});

void test("an event only an unadvanced mocked clock can produce fails naming the awaited event", async (context) => {
  catalogClock(context);
  const alarm = new Promise<string>((resolve) => { setTimeout(() => { resolve("rung"); }, 5_000); });
  await assert.rejects(settledWithin(alarm, "the scripted alarm", 5), /the scripted alarm while the mocked clock stayed unadvanced/);
});

void test("an event a ticked mocked timer produces still arrives", async (context) => {
  catalogClock(context);
  const alarm = new Promise<string>((resolve) => { setTimeout(() => { resolve("rung"); }, 5_000); });
  context.mock.timers.tick(5_000);
  assert.equal(await settledWithin(alarm, "the scripted alarm", 5), "rung");
});

void test("an event that outlives real loop turns still arrives", async () => {
  const slow = (async () => { for (let turn = 0; turn < 50; turn++) await setImmediate(); return "slow"; })();
  assert.equal(await settledWithin(slow, "the slow event", 100), "slow");
});
