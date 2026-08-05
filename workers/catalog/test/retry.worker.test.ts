import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRY_ATTEMPTS,
  isRetryableStatus,
  parseRetryAfter,
  RetryableError,
  withRetry,
  type RetryOptions,
} from "../src/ingest/retry";

/**
 * Unit tests for the bounded-backoff retry wrapper (catalog/src/ingest/retry.ts).
 *
 * A fake clock replaces the default sleeper so tests assert the exact waits
 * without any real timers. `jitterMs` is injected as deterministic zero so
 * backoff delays are exact.
 */

/** A fake clock: records requested waits and resolves instantly — no real timers. */
function fakeClock(): { sleep: RetryOptions["sleep"]; waits: number[] } {
  const waits: number[] = [];
  return {
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    waits,
  };
}

/** Deterministic identity jitter so exponential delays are asserted exactly. */
const noJitter = (baseMs: number): number => baseMs;

/**
 * Unconditional attempt script: throws `error` for the first `n` calls, then
 * returns `value`. Keeps test bodies free of conditional logic — the failure
 * cases are spelled out in the call, not branched on at runtime.
 */
function failFirstNTimes<T>(n: number, error: Error, value: T): () => T {
  let remaining = n;
  return () => {
    if (remaining > 0) {
      remaining -= 1;
      throw error;
    }
    return value;
  };
}

describe("isRetryableStatus", () => {
  it("classifies 5xx and transient 4xx as retryable", () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
  });

  it("classifies other 4xx as non-retryable", () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(422)).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfter("120", 0)).toBe(120_000);
  });

  it("parses an HTTP-date as the wait measured from now", () => {
    expect(parseRetryAfter("Wed, 01 Jan 1970 00:16:40 GMT", 40_000)).toBe(960_000);
  });

  it("returns null when the value is absent or unparseable", () => {
    expect(parseRetryAfter(null, 0)).toBeNull();
    expect(parseRetryAfter("some day", 0)).toBeNull();
  });
});

describe("withRetry — success paths", () => {
  it("succeeds on the first attempt without sleeping", async () => {
    const { sleep, waits } = fakeClock();
    const result = await withRetry(() => "ok", { sleep });
    expect(result).toBe("ok");
    expect(waits).toEqual([]);
  });

  it("backs off exponentially between attempts, then succeeds", async () => {
    const { sleep, waits } = fakeClock();
    const result = await withRetry(
      failFirstNTimes(2, new RetryableError(503), "ok"),
      { sleep, jitterMs: noJitter, baseDelayMs: 400 },
    );
    expect(result).toBe("ok");
    expect(waits).toEqual([400, 800]);
  });
});

describe("withRetry — Retry-After", () => {
  it("honors Retry-After over the backoff", async () => {
    const { sleep, waits } = fakeClock();
    await expect(
      withRetry(() => {
        throw new RetryableError(429, 2000);
      }, { sleep, attempts: 2 }),
    ).rejects.toThrow(RetryableError);
    expect(waits).toEqual([2000]);
  });

  it("caps the Retry-After wait at maxDelayMs", async () => {
    const { sleep, waits } = fakeClock();
    await expect(
      withRetry(() => {
        throw new RetryableError(429, 600_000);
      }, { sleep, attempts: 2, maxDelayMs: 10_000 }),
    ).rejects.toThrow(RetryableError);
    expect(waits).toEqual([10_000]);
  });
});

describe("withRetry — failure handling", () => {
  it("raises non-transient errors immediately", async () => {
    const { sleep, waits } = fakeClock();
    let calls = 0;
    await expect(
      withRetry(() => {
        calls += 1;
        throw new Error("boom");
      }, { sleep }),
    ).rejects.toThrow("boom");
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  });

  it("rethrows the last transient error once attempts are exhausted", async () => {
    const { sleep, waits } = fakeClock();
    let calls = 0;
    await expect(
      withRetry(() => {
        calls += 1;
        throw new RetryableError(503);
      }, { sleep, jitterMs: noJitter, baseDelayMs: 400 }),
    ).rejects.toEqual(expect.objectContaining({ name: RetryableError.name, status: 503 }));
    expect(calls).toBe(DEFAULT_RETRY_ATTEMPTS);
    expect(waits).toEqual([400, 800]);
  });

  it("respects an injected attempt cap", async () => {
    const { sleep, waits } = fakeClock();
    let calls = 0;
    await expect(
      withRetry(() => {
        calls += 1;
        throw new RetryableError(500);
      }, { sleep, attempts: 1 }),
    ).rejects.toThrow(RetryableError);
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  });
});

describe("withRetry — invalid attempt caps", () => {
  it.each([
    ["NaN", Number.NaN],
    ["zero", 0],
    ["negative", -1],
    ["not an integer", 2.5],
  ])("falls back to the default when attempts is %s", async (_label, attempts) => {
    const { sleep, waits } = fakeClock();
    let calls = 0;
    await expect(
      withRetry(() => {
        calls += 1;
        throw new RetryableError(503);
      }, { sleep, jitterMs: noJitter, baseDelayMs: 400, attempts }),
    ).rejects.toThrow(RetryableError);
    expect(calls).toBe(DEFAULT_RETRY_ATTEMPTS);
    expect(waits).toEqual([400, 800]);
  });
});
