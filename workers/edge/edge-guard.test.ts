import test from "node:test";
import assert from "node:assert/strict";
import { EdgeGuard, isRateLimitPath, RECLAIM_WINDOW_KEY, reclaimDelayMs } from "./edge-guard.ts";
import { fakeStorage } from "./guard-doubles.ts";
import { RATE_LIMIT_KEY } from "./rate-limiter.ts";

// P2-3 (issue #284 / Task 9): a per-identity rate-limit shard is reclaimed
// two windows after its last write so an abandoned identity's shard doesn't
// occupy storage forever. The daily budget shard is a fixed, separate DO
// instance (`idFromName("budget")`, cost-breaker.ts) and never receives the
// `/rate-limit` pathname, so it can never be swept by this mechanism.

void test("only the /rate-limit pathname schedules a reclaim", () => {
  assert.equal(isRateLimitPath("/rate-limit"), true);
  assert.equal(isRateLimitPath("/budget"), false);
  assert.equal(isRateLimitPath("/"), false);
});

void test("the reclaim delay is exactly two windows out", () => {
  assert.equal(reclaimDelayMs(60), 120_000);
  assert.equal(reclaimDelayMs(1), 2_000);
});

// ── EdgeGuard class behavior (round 3: P1-3 / P2-4, a storage-stub double) ──
// These were the tests missing that let the previous two bugs (wrong window
// source, unconditional write-per-request) ship unnoticed.

function fakeCtx(env: Record<string, unknown> = {}) {
  const storage = fakeStorage();
  const guard = new EdgeGuard({ storage: storage.state } as unknown as DurableObjectState, env);
  return { guard, data: storage.data, getAlarmAt: () => storage.alarm.at, getSetAlarmCalls: () => storage.alarm.calls };
}

function rateLimitRequest(config: { limit: number; windowSeconds: number }) {
  return new Request("https://edge-guard/rate-limit", { method: "POST", body: JSON.stringify(config) });
}

void test("a /rate-limit request arms the reclaim alarm once, and a second request does not re-arm it (P2-4)", async () => {
  const { guard, getAlarmAt, getSetAlarmCalls } = fakeCtx({ ANON_RATE_LIMIT_WINDOW_SECONDS: "60" });
  await guard.fetch(rateLimitRequest({ limit: 20, windowSeconds: 60 }));
  assert.notEqual(getAlarmAt(), null);
  assert.equal(getSetAlarmCalls(), 1);
  await guard.fetch(rateLimitRequest({ limit: 20, windowSeconds: 60 }));
  assert.equal(getSetAlarmCalls(), 1, "an already-armed shard must not call setAlarm again");
});

void test("the alarm uses the WIDER of the applied and fallback windows, not the fallback alone (P1-3)", async () => {
  const { guard, getAlarmAt } = fakeCtx({ ANON_RATE_LIMIT_WINDOW_SECONDS: "60" });
  const before = Date.now();
  await guard.fetch(rateLimitRequest({ limit: 1, windowSeconds: 3600 }));
  const after = Date.now();
  const alarmAt = getAlarmAt();
  assert.ok(alarmAt !== null);
  assert.ok(alarmAt >= before + reclaimDelayMs(3600), "must schedule off the wider 3600s applied window");
  assert.ok(alarmAt <= after + reclaimDelayMs(3600));
});

void test("when the alarm fires on a still-fresh window, it rearms rather than deleting (P2-4)", async () => {
  const { guard, data, getAlarmAt } = fakeCtx({});
  data.set(RATE_LIMIT_KEY, { startedAtMs: Date.now(), count: 1 });
  data.set(RECLAIM_WINDOW_KEY, 3600);
  await guard.alarm();
  assert.equal(data.has(RATE_LIMIT_KEY), true, "a still-fresh window must survive the alarm");
  assert.notEqual(getAlarmAt(), null, "the shard must stay guarded, not go dark");
});

void test("when the alarm fires on a stale window, it deletes the rate-limit AND reclaim-bookkeeping keys — but nothing else (P2-4/P3)", async () => {
  const { guard, data } = fakeCtx({});
  data.set(RATE_LIMIT_KEY, { startedAtMs: 0, count: 5 });
  data.set(RECLAIM_WINDOW_KEY, 60);
  data.set("budget-latch", { dayKey: "2026-07-29" });
  await guard.alarm();
  assert.equal(data.has(RATE_LIMIT_KEY), false, "a stale window must be swept");
  assert.equal(data.has(RECLAIM_WINDOW_KEY), false, "the reclaim bookkeeping key must not survive forever");
  assert.deepEqual(data.get("budget-latch"), { dayKey: "2026-07-29" }, "a targeted delete, not deleteAll, leaves unrelated keys alone");
});
