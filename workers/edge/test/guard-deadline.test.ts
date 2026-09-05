/**
 * EG-21 (#1343, 08-26 §3 still open): a guard Durable Object that never answers
 * must not hold the request open.
 *
 * Both guard calls had a `try`/`catch` (or none at all) and no deadline, so a
 * hung shard held every fail-closed `/v1/chat` open indefinitely instead of
 * answering the designed 503. The deadline is not a new verdict: "no answer in
 * time" maps onto the SAME outage the callers already handle.
 *
 * The clock is mocked, never waited on — `guardCall`'s timer is a plain
 * `setTimeout` for exactly this reason, as its sibling in `container-fetch.ts`
 * is. Mutation guard: dropping the `Promise.race` from `guardCall` makes these
 * cases hang past the deadline instead of resolving, which node:test reports
 * red (the same signal `container-fetch-timeout.test.ts` relies on).
 *
 * test-type: unit
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { GUARD_CALL_TIMEOUT_MS, guardCall } from "../src/protect/guard-call.ts";
import { durableBurstCheck } from "../src/protect/rate-limiter.ts";
import { budgetLatched, utcDayKey } from "../src/protect/cost-breaker.ts";
import type { GuardNamespace } from "../src/protect/guard-store.ts";

const CONFIG = { limit: 20, windowSeconds: 60 };
const DAY = utcDayKey(Date.UTC(2026, 8, 5));
const REQUEST = new Request("https://edge-guard/rate-limit", { method: "POST" });

/** A shard that accepts the call and then never answers it — a wedged Durable
 * Object, which is silence rather than an error. */
function silentShard(captured: { signal?: AbortSignal } = {}) {
  return {
    fetch: (request: Request) => {
      captured.signal = request.signal;
      return new Promise<Response>(() => undefined);
    },
  };
}

function namespaceOf(shard: { fetch: (request: Request) => Promise<Response> }): GuardNamespace {
  return { idFromName: (name: string) => name as unknown as DurableObjectId, get: () => shard };
}

/** Runs `call`, advances the mocked clock past the guard deadline, and hands
 * back what the call settled on. */
async function pastTheDeadline<T>(call: () => Promise<T>): Promise<T> {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const settling = call();
    mock.timers.tick(GUARD_CALL_TIMEOUT_MS);
    return await settling;
  } finally {
    mock.timers.reset();
  }
}

void test("production bounds a guard call well inside the /v1 head timeout", () => {
  assert.equal(GUARD_CALL_TIMEOUT_MS, 5_000);
});

void test("a shard that never answers is no verdict once the deadline passes", async () => {
  assert.equal(await pastTheDeadline(() => guardCall(silentShard(), REQUEST)), null);
});

void test("a shard that answers inside the deadline is passed through untouched", async () => {
  const answered = new Response("{}", { status: 200 });
  assert.equal(await guardCall({ fetch: () => Promise.resolve(answered) }, REQUEST), answered);
});

void test("the deadline rides the request, so the shard's own work is cancelled too", async () => {
  const captured: { signal?: AbortSignal } = {};
  await pastTheDeadline(() => guardCall(silentShard(captured), REQUEST));
  assert.equal(captured.signal?.aborted, true);
});

void test("a durable burst check that runs out of time is an outage, never a silent allow", async () => {
  const verdict = await pastTheDeadline(() => durableBurstCheck(namespaceOf(silentShard()), "user-a", CONFIG));
  assert.deepEqual(verdict, { kind: "outage" });
});

void test("a budget latch that runs out of time does not claim the day is spent", async () => {
  assert.equal(await pastTheDeadline(() => budgetLatched(namespaceOf(silentShard()), DAY)), false);
});
