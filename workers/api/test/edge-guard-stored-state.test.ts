/**
 * SUT: the guard Durable Object (`EdgeGuard`, `src/protect/edge-guard.ts`),
 * entered through `fetch` and `alarm` over an in-memory storage. This file pins
 * how the object reads the two values it stores today, the budget latch under
 * "budget-latch" and an identity's window under "window", when the stored
 * shape is not exactly the one it writes.
 *
 * Today a stored value is taken when each field has the right `typeof`: an
 * extra key is ignored and NaN passes as a number. Storage is structured
 * clone, not JSON, so a NaN field is a shape the object can meet. A NaN start
 * never expires and gives a retry hint of NaN, which the JSON answer carries
 * as null; the reclaim alarm still sweeps it. A NaN count denies inside its
 * window. Each row is today's answer, kept as it is.
 *
 * test-type: characterization
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EdgeGuard } from "../src/protect/edge-guard.ts";
import { fakeStorage } from "./doubles/guard-doubles.ts";

/** 2026-11-23T12:00:00Z. */
const NOW = 1795435200000;
const DAY = "2026-11-23";
/** The limiter config each window row's request carries: two per minute. */
const TWO_PER_MINUTE = '{"limit":2,"windowSeconds":60}';

function guardOver(t: TestContext, stored: Readonly<Record<string, unknown>>) {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const storage = fakeStorage();
  for (const [key, value] of Object.entries(stored)) storage.data.set(key, value);
  const guard = new EdgeGuard({ storage: storage.state } as unknown as DurableObjectState, {});
  return { guard, data: storage.data, alarm: storage.alarm };
}

type LatchReading = readonly [shape: string, stored: unknown, answer: string];

const LATCHES: readonly LatchReading[] = [
  ["exactly as written", { dayKey: DAY }, '{"latched":true}'],
  ["with an extra key", { dayKey: DAY, setBy: "agent tier" }, '{"latched":true}'],
  ["for another day", { dayKey: "2026-11-22" }, '{"latched":false}'],
  ["with a numeric day", { dayKey: 20261123 }, '{"latched":false}'],
];

for (const [shape, stored, answer] of LATCHES) {
  void test(`a stored latch ${shape} answers ${answer}`, async (t) => {
    const { guard } = guardOver(t, { "budget-latch": stored });
    const response = await guard.fetch(new Request(`https://edge-guard/budget?dayKey=${DAY}`));
    assert.equal(await response.text(), answer);
  });
}

interface WindowReading {
  readonly says: string;
  readonly stored: unknown;
  readonly answers: readonly string[];
  readonly after: unknown;
}

const WINDOWS: readonly WindowReading[] = [
  { says: "exactly as written counts one more check", stored: { startedAtMs: NOW - 1_000, count: 1 },
    answers: ['{"allowed":true,"retryAfterSeconds":59}'], after: { startedAtMs: NOW - 1_000, count: 2 } },
  { says: "with an extra key still counts: denied at its limit", stored: { startedAtMs: NOW - 1_000, count: 2, shard: "rate:authed:u1" },
    answers: ['{"allowed":false,"retryAfterSeconds":59}'], after: { startedAtMs: NOW - 1_000, count: 2, shard: "rate:authed:u1" } },
  { says: "with a NaN start never expires and hints a null retry", stored: { startedAtMs: Number.NaN, count: 1 },
    answers: ['{"allowed":true,"retryAfterSeconds":null}', '{"allowed":false,"retryAfterSeconds":null}'],
    after: { startedAtMs: Number.NaN, count: 2 } },
  { says: "with a NaN count denies inside its window", stored: { startedAtMs: NOW - 1_000, count: Number.NaN },
    answers: ['{"allowed":false,"retryAfterSeconds":59}'], after: { startedAtMs: NOW - 1_000, count: Number.NaN } },
  { says: "with a string start is discarded for a fresh window", stored: { startedAtMs: "2026-11-23T11:59:59Z", count: 1 },
    answers: ['{"allowed":true,"retryAfterSeconds":60}'], after: { startedAtMs: NOW, count: 1 } },
];

/** The bodies of `count` consecutive two-per-minute checks, in order. */
async function answersTo(guard: EdgeGuard, count: number): Promise<string[]> {
  const answers: string[] = [];
  for (let sent = 0; sent < count; sent += 1) {
    const request = new Request("https://edge-guard/rate-limit", { method: "POST", body: TWO_PER_MINUTE });
    answers.push(await (await guard.fetch(request)).text());
  }
  return answers;
}

for (const window of WINDOWS) {
  void test(`a stored window ${window.says}`, async (t) => {
    const { guard, data } = guardOver(t, { window: window.stored });
    assert.deepEqual(await answersTo(guard, window.answers.length), window.answers);
    assert.deepEqual(data.get("window"), window.after);
  });
}

interface AlarmReading {
  readonly shape: string;
  readonly stored: unknown;
  readonly kept: readonly string[];
  readonly rearmedAt: number | null;
}

const ALARMS: readonly AlarmReading[] = [
  { shape: "a live window with an extra key is kept and rearmed", stored: { startedAtMs: NOW - 1_000, count: 1, shard: "rate:authed:u1" },
    kept: ["window", "reclaim-window-seconds"], rearmedAt: NOW + 120_000 },
  { shape: "a window with a NaN start is swept", stored: { startedAtMs: Number.NaN, count: 1 }, kept: [], rearmedAt: null },
];

for (const alarm of ALARMS) {
  void test(`when the reclaim alarm fires, ${alarm.shape}`, async (t) => {
    const { guard, data, alarm: scheduled } = guardOver(t, { window: alarm.stored, "reclaim-window-seconds": 60 });
    await guard.alarm();
    assert.deepEqual([...data.keys()], alarm.kept);
    assert.equal(scheduled.at, alarm.rearmedAt);
  });
}
