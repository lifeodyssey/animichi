/**
 * SUT: the guard Durable Object (`EdgeGuard`, `src/protect/edge-guard.ts`),
 * entered through `fetch` and `alarm` over an in-memory storage. This file pins
 * how the object reads the two values it stores today, the budget latch under
 * "budget-latch" and an identity's window under "window", when the stored
 * shape is not exactly the one it writes.
 *
 * A stored value is taken when each field has the right type, and an extra key
 * is ignored. Storage is structured clone, not JSON, so a NaN or an Infinity
 * field is a shape the object can meet. A window whose start or count is not a
 * finite number is no window: the check is judged as a new window, which is
 * stored, and its retry hint is a finite number of seconds. A finite window is
 * counted as stored, however unusual, because resetting it could let a burst
 * through. The reclaim alarm reads a window the same way and sweeps one that is
 * no window, and a check that resets one arms the alarm as a check on no window
 * does.
 * A recorded reclaim window that is not finite, or is longer than the longest
 * window the guard accepts, is treated as absent: the alarm uses the deployed one.
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

/** A guard object over in-memory storage that already holds `stored`. */
function guardHolding(stored: Readonly<Record<string, unknown>>) {
  const storage = fakeStorage();
  for (const [key, value] of Object.entries(stored)) storage.data.set(key, value);
  const guard = new EdgeGuard({ storage: storage.state } as unknown as DurableObjectState, {});
  return { guard, data: storage.data, alarm: storage.alarm };
}

function guardOver(t: TestContext, stored: Readonly<Record<string, unknown>>) {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  return guardHolding(stored);
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

/** What one check judged as a new window gets: allowed, and a window from now holding that check. */
const JUDGED_AS_NEW = { answers: ['{"allowed":true,"retryAfterSeconds":60}'], after: { startedAtMs: NOW, count: 1 } };

const WINDOWS: readonly WindowReading[] = [
  { says: "exactly as written counts one more check", stored: { startedAtMs: NOW - 1_000, count: 1 },
    answers: ['{"allowed":true,"retryAfterSeconds":59}'], after: { startedAtMs: NOW - 1_000, count: 2 } },
  { says: "with an extra key still counts: denied at its limit", stored: { startedAtMs: NOW - 1_000, count: 2, shard: "rate:authed:u1" },
    answers: ['{"allowed":false,"retryAfterSeconds":59}'], after: { startedAtMs: NOW - 1_000, count: 2, shard: "rate:authed:u1" } },
  { says: "with a NaN start is judged as a new window, which then counts to its limit", stored: { startedAtMs: Number.NaN, count: 1 },
    answers: ['{"allowed":true,"retryAfterSeconds":60}', '{"allowed":true,"retryAfterSeconds":60}', '{"allowed":false,"retryAfterSeconds":60}'],
    after: { startedAtMs: NOW, count: 2 } },
  { says: "with a NaN count is judged as a new window", stored: { startedAtMs: NOW - 1_000, count: Number.NaN }, ...JUDGED_AS_NEW },
  { says: "with a string start is discarded for a fresh window", stored: { startedAtMs: "2026-11-23T11:59:59Z", count: 1 },
    answers: ['{"allowed":true,"retryAfterSeconds":60}'], after: { startedAtMs: NOW, count: 1 } },
  { says: "with an Infinity start is judged as a new window", stored: { startedAtMs: Number.POSITIVE_INFINITY, count: 1 }, ...JUDGED_AS_NEW },
  { says: "with a -Infinity start is judged as a new window", stored: { startedAtMs: Number.NEGATIVE_INFINITY, count: 1 }, ...JUDGED_AS_NEW },
  { says: "with an Infinity count is judged as a new window", stored: { startedAtMs: NOW - 1_000, count: Number.POSITIVE_INFINITY }, ...JUDGED_AS_NEW },
  { says: "with a -Infinity count is judged as a new window", stored: { startedAtMs: NOW - 1_000, count: Number.NEGATIVE_INFINITY }, ...JUDGED_AS_NEW },
  { says: "with a negative count is counted as stored", stored: { startedAtMs: NOW - 1_000, count: -1 },
    answers: ['{"allowed":true,"retryAfterSeconds":59}'], after: { startedAtMs: NOW - 1_000, count: 0 } },
  { says: "with a fractional count is counted as stored", stored: { startedAtMs: NOW - 1_000, count: 1.5 },
    answers: ['{"allowed":true,"retryAfterSeconds":59}'], after: { startedAtMs: NOW - 1_000, count: 2.5 } },
  { says: "with a start in the future is counted as stored", stored: { startedAtMs: NOW + 30_000, count: 2 },
    answers: ['{"allowed":false,"retryAfterSeconds":90}'], after: { startedAtMs: NOW + 30_000, count: 2 } },
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

/** When one two-per-minute check over `stored` arms the reclaim alarm, and the window it records for the alarm. */
async function reclaimArmedBy(stored: Readonly<Record<string, unknown>>) {
  const { guard, data, alarm } = guardHolding(stored);
  await answersTo(guard, 1);
  return { at: alarm.at, window: data.get("reclaim-window-seconds") };
}

void test("a check that resets a window with a NaN start arms the reclaim alarm exactly as a check on no window does", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const fresh = await reclaimArmedBy({});
  assert.deepEqual(fresh, { at: NOW + 120_000, window: 60 });
  assert.deepEqual(await reclaimArmedBy({ window: { startedAtMs: Number.NaN, count: 1 } }), fresh);
});

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
  { shape: "a window with an Infinity start is swept", stored: { startedAtMs: Number.POSITIVE_INFINITY, count: 1 }, kept: [], rearmedAt: null },
  { shape: "a live window with a NaN count is swept", stored: { startedAtMs: NOW - 1_000, count: Number.NaN }, kept: [], rearmedAt: null },
];

for (const alarm of ALARMS) {
  void test(`when the reclaim alarm fires, ${alarm.shape}`, async (t) => {
    const { guard, data, alarm: scheduled } = guardOver(t, { window: alarm.stored, "reclaim-window-seconds": 60 });
    await guard.alarm();
    assert.deepEqual([...data.keys()], alarm.kept);
    assert.equal(scheduled.at, alarm.rearmedAt);
  });
}

/** An alarm firing on a window it recorded the reclaim basis for; the guard's deployed window is the default 60 s. */
interface ReclaimReading extends AlarmReading {
  readonly recorded: number;
}

const LIVE = { startedAtMs: NOW - 1_000, count: 1 };
const BOTH_KEPT = ["window", "reclaim-window-seconds"];

const RECLAIMS: readonly ReclaimReading[] = [
  { shape: "a live window recorded with an Infinity basis is rearmed on the deployed window", stored: LIVE, recorded: Number.POSITIVE_INFINITY,
    kept: BOTH_KEPT, rearmedAt: NOW + 120_000 },
  { shape: "a live window recorded with a basis past the bound is rearmed on the deployed window", stored: LIVE, recorded: 4_000_000_000_001,
    kept: BOTH_KEPT, rearmedAt: NOW + 120_000 },
  { shape: "a stale window recorded with an Infinity basis is swept", stored: { startedAtMs: NOW - 61_000, count: 1 },
    recorded: Number.POSITIVE_INFINITY, kept: [], rearmedAt: null },
  { shape: "a live window recorded with a basis of exactly the bound is rearmed on it", stored: LIVE, recorded: 4_000_000_000_000,
    kept: BOTH_KEPT, rearmedAt: NOW + 8_000_000_000_000_000 },
];

for (const reading of RECLAIMS) {
  void test(`when the reclaim alarm fires, ${reading.shape}`, async (t) => {
    const { guard, data, alarm } = guardOver(t, { window: reading.stored, "reclaim-window-seconds": reading.recorded });
    await guard.alarm();
    assert.deepEqual([...data.keys()], reading.kept);
    assert.equal(alarm.at, reading.rearmedAt);
  });
}
