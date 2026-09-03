/**
 * W1-2 (#1251): the singleton RunSweeper's own schedule. The sweep's SELECT is
 * proven against real PostgreSQL in `db-test/`, and its re-arm loop in
 * `run-sweep.test.ts`; what this file pins is the property that makes the
 * backstop a backstop at all — that it keeps ticking.
 *
 * test-type: unit (storage double, no Cloudflare bindings, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RunSweeper, SWEEP_INTERVAL_VAR } from "../src/agent/sweeper/run-sweeper.ts";
import { RUN_SWEEP_SCHEDULE_PATH } from "../src/agent/sweeper/run-backstop.ts";
import { fakeStorage } from "./doubles/guard-doubles.ts";

const THIRTY_SECONDS = 30_000;

function makeSweeper(env: Record<string, unknown> = { [SWEEP_INTERVAL_VAR]: "30" }) {
  const storage = fakeStorage();
  const sweeper = new RunSweeper({ storage: storage.state } as unknown as DurableObjectState, env);
  return { sweeper, alarm: storage.alarm };
}

function scheduleRequest(): Request {
  return new Request(`https://run-sweeper${RUN_SWEEP_SCHEDULE_PATH}`, { method: "POST" });
}

void test("the first schedule request starts the tick; a second one writes nothing", async () => {
  const { sweeper, alarm } = makeSweeper();
  const before = Date.now();
  const response = await sweeper.fetch(scheduleRequest());
  const after = Date.now();
  await sweeper.fetch(scheduleRequest());
  assert.equal(response.status, 204);
  assert.equal(alarm.calls, 1, "an already-ticking sweeper must not re-arm on every request");
  assert.ok(alarm.at !== null && alarm.at >= before + THIRTY_SECONDS && alarm.at <= after + THIRTY_SECONDS);
});

void test("the sweeper answers nothing but its own schedule path", async () => {
  const { sweeper, alarm } = makeSweeper();
  const response = await sweeper.fetch(new Request("https://run-sweeper/sweep", { method: "POST" }));
  assert.equal(response.status, 404);
  assert.equal(alarm.calls, 0);
});

void test("an alarm arms the next tick before it sweeps, so a failing sweep is not the last one", async () => {
  const { sweeper, alarm } = makeSweeper();
  await assert.rejects(sweeper.alarm(), /AGENT_SESSION is not bound/);
  assert.equal(alarm.calls, 1);
  assert.notEqual(alarm.at, null);
});
