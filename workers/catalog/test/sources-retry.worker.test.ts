import { describe, expect, it } from "vitest";
import { fetchAnitabiPoints, UpstreamFetchError, UpstreamNotFoundError, type FetchLike } from "../src/ingest/sources";
import { fakeSleep, mockFetchSequence } from "./mock-fetch-sequence";

describe("retry wiring — transient retries", () => {
  it("honors Retry-After on a 429, then succeeds on the retry", async () => {
    const { sleep, waits } = fakeSleep();
    const { fetch, callCount } = mockFetchSequence([
      { status: 429, body: null, headers: { "retry-after": "2" } },
      { status: 200, body: { points: [{ id: "p1" }] } },
    ]);
    const points = await fetchAnitabiPoints("3302", {
      fetchImpl: fetch,
      retry: { sleep },
    });
    expect(points).toHaveLength(1);
    expect(callCount()).toBe(2);
    expect(waits).toEqual([2000]);
  });

  it("retries a 5xx with backoff, then succeeds", async () => {
    const { sleep, waits } = fakeSleep();
    const { fetch, callCount } = mockFetchSequence([
      { status: 503, body: null },
      { status: 503, body: null },
      { status: 200, body: { points: [{ id: "p1" }] } },
    ]);
    const points = await fetchAnitabiPoints("3302", {
      fetchImpl: fetch,
      retry: { sleep, jitterMs: (ms) => ms, baseDelayMs: 400 },
    });
    expect(points).toHaveLength(1);
    expect(callCount()).toBe(3);
    expect(waits).toEqual([400, 800]);
  });
});

describe("retry wiring — transport errors", () => {
  it("retries a transport error, then succeeds", async () => {
    const { sleep, waits } = fakeSleep();
    let calls = 0;
    const fetch: FetchLike = () => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("network down"));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ points: [{ id: "p1" }] }),
      });
    };
    const points = await fetchAnitabiPoints("3302", {
      fetchImpl: fetch,
      retry: { sleep, jitterMs: (ms) => ms, baseDelayMs: 400 },
    });
    expect(points).toHaveLength(1);
    expect(calls).toBe(2);
    expect(waits).toEqual([400]);
  });
});

describe("retry wiring — terminal failures", () => {
  it("raises 404 immediately without retrying", async () => {
    const { sleep, waits } = fakeSleep();
    const { fetch, callCount } = mockFetchSequence([{ status: 404, body: null }]);
    await expect(
      fetchAnitabiPoints("3302", { fetchImpl: fetch, retry: { sleep } }),
    ).rejects.toEqual(expect.objectContaining({ name: UpstreamNotFoundError.name }));
    expect(callCount()).toBe(1);
    expect(waits).toEqual([]);
  });

  it("raises UpstreamFetchError once retries are exhausted", async () => {
    const { sleep, waits } = fakeSleep();
    const { fetch, callCount } = mockFetchSequence([
      { status: 503, body: null },
      { status: 503, body: null },
      { status: 503, body: null },
    ]);
    await expect(
      fetchAnitabiPoints("3302", {
        fetchImpl: fetch,
        retry: { sleep, jitterMs: (ms) => ms, baseDelayMs: 400 },
      }),
    ).rejects.toEqual(
      expect.objectContaining({ name: UpstreamFetchError.name, upstream: "anitabi" }),
    );
    expect(callCount()).toBe(3);
    expect(waits).toEqual([400, 800]);
  });
});
