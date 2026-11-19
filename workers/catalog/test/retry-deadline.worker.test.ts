import { afterEach, describe, expect, it, vi } from "vitest";
import { RetryableError, withRetry, type RetryOptions } from "../src/ingest/retry";

/**
 * SUT: `withRetry`'s overall deadline and its caller's cancellation
 * (`src/ingest/retry.ts`). A manual clock stands in for time: `sleep` and a
 * scripted attempt advance it, and nothing waits for real.
 */

const ATTEMPT_MS = 12_000;
const DEADLINE_MS = 20_000;

interface ManualClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  pass: (ms: number) => void;
  waits: number[];
}

function manualClock(): ManualClock {
  let at = 0;
  const waits: number[] = [];
  return {
    now: () => at,
    sleep: (ms) => { waits.push(ms); at += ms; return Promise.resolve(); },
    pass: (ms) => { at += ms; },
    waits,
  };
}

/** A 12 s attempt inside a 20 s deadline, with an exact 400 ms backoff base. */
function policy(clock: ManualClock): RetryOptions {
  return {
    attemptTimeoutMs: ATTEMPT_MS, deadlineMs: DEADLINE_MS, baseDelayMs: 400,
    jitterMs: (ms) => ms, now: clock.now, sleep: clock.sleep,
  };
}

/** One scripted attempt: how long it runs on the clock, and how it fails. */
interface Step { tookMs: number; error: Error }

const UNSCRIPTED: Step = { tookMs: 0, error: new Error("an attempt the test did not script") };
const FAST_503: Step = { tookMs: 0, error: new RetryableError(503) };
const HUNG: Step = { tookMs: ATTEMPT_MS, error: new RetryableError() };

/** Attempts that play `steps` in order on the clock, counting the calls. */
function scripted(clock: ManualClock, steps: readonly Step[]) {
  let calls = 0;
  const attempt = () => {
    const step = steps.at(calls) ?? UNSCRIPTED;
    calls += 1;
    clock.pass(step.tookMs);
    return Promise.reject(step.error);
  };
  return { attempt, calls: () => calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withRetry deadline", () => {
  it("retries fast transient failures while a full attempt still fits", async () => {
    const clock = manualClock();
    const { attempt, calls } = scripted(clock, [FAST_503, FAST_503, FAST_503]);
    await expect(withRetry(attempt, policy(clock))).rejects.toMatchObject({ status: 503 });
    expect(calls()).toBe(3);
    expect(clock.waits).toEqual([400, 800]);
  });

  it("starts no retry after an attempt that ran to its timeout", async () => {
    const clock = manualClock();
    const { attempt, calls } = scripted(clock, [HUNG, FAST_503]);
    await expect(withRetry(attempt, policy(clock))).rejects.toBe(HUNG.error);
    expect(calls()).toBe(1);
    expect(clock.waits).toEqual([]);
  });

  it("stops once the time left cannot hold the wait plus a full attempt", async () => {
    const clock = manualClock();
    const { attempt, calls } = scripted(clock, [FAST_503, HUNG, FAST_503]);
    await expect(withRetry(attempt, policy(clock))).rejects.toBe(HUNG.error);
    expect(calls()).toBe(2);
    expect(clock.waits).toEqual([400]);
  });

  it("waits out a Retry-After whose retry still ends on the deadline", async () => {
    const clock = manualClock();
    const { attempt, calls } = scripted(clock, [{ tookMs: 0, error: new RetryableError(429, 8_000) }, FAST_503]);
    await expect(withRetry(attempt, policy(clock))).rejects.toMatchObject({ status: 503 });
    expect(calls()).toBe(2);
    expect(clock.waits).toEqual([8_000]);
  });

  it("gives up on a Retry-After whose retry would end past the deadline", async () => {
    const clock = manualClock();
    const { attempt, calls } = scripted(clock, [{ tookMs: 0, error: new RetryableError(429, 8_001) }, FAST_503]);
    await expect(withRetry(attempt, policy(clock))).rejects.toMatchObject({ status: 429 });
    expect(calls()).toBe(1);
    expect(clock.waits).toEqual([]);
  });
});

describe("withRetry caller cancellation", () => {
  it("surfaces the caller's own reason, not an upstream failure, and retries nothing", async () => {
    const clock = manualClock();
    const caller = new AbortController();
    const reason = new Error("the caller left");
    const attempt = () => { caller.abort(reason); return Promise.reject(new RetryableError()); };
    await expect(withRetry(attempt, policy(clock), caller.signal)).rejects.toBe(reason);
    expect(clock.waits).toEqual([]);
  });

  it("starts no attempt once a cancel lands during the backoff wait", async () => {
    const clock = manualClock();
    const caller = new AbortController();
    const reason = new Error("the pass ran out");
    const sleep = (ms: number) => { caller.abort(reason); return clock.sleep(ms); };
    const { attempt, calls } = scripted(clock, [FAST_503, FAST_503]);
    await expect(withRetry(attempt, { ...policy(clock), sleep }, caller.signal)).rejects.toBe(reason);
    expect(calls()).toBe(1);
  });

  it("runs each attempt under the caller's signal and its own timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const caller = new AbortController();
    const seen: AbortSignal[] = [];
    const attempt = (signal: AbortSignal) => { seen.push(signal); caller.abort(); return Promise.reject(new RetryableError()); };
    await expect(withRetry(attempt, { attemptTimeoutMs: ATTEMPT_MS }, caller.signal)).rejects.toBeInstanceOf(DOMException);
    expect(seen.map((signal) => signal.aborted)).toEqual([true]);
    expect(timeout).toHaveBeenCalledWith(ATTEMPT_MS);
  });
});
