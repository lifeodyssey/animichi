import { describe, expect, it } from "vitest";
import {
  fetchAnitabiLite,
  fetchAnitabiPoints,
  fetchBangumiSubject,
  UpstreamFetchError,
  UpstreamNotFoundError,
  type FetchLike,
} from "../src/ingest/sources";

/**
 * Unit tests for the upstream source fetchers (catalog/src/ingest/sources.ts).
 *
 * An injected mock `fetch` keeps these off the network: each test feeds a
 * canned response and asserts (a) the endpoint/params match the ported Python
 * clients and (b) the body parses into the typed raw shape. Pure I/O wiring;
 * named *.worker.test.ts so the vitest-pool-workers config picks it up.
 */

/** Build a mock FetchLike that records the URL and returns a canned JSON body. */
function mockFetch(
  body: unknown,
  opts: { ok?: boolean; status?: number } = {},
): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = (url) => {
    urls.push(url);
    return Promise.resolve({
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: () => Promise.resolve(body),
    });
  };
  return { fetch, urls };
}

/** Build a mock FetchLike serving canned responses in sequence, with optional headers. */
function mockFetchSequence(
  responses: { status: number; body: unknown; headers?: Record<string, string> }[],
): { fetch: FetchLike; callCount: () => number } {
  let calls = 0;
  const fetch: FetchLike = () => {
    const response = responses[calls];
    if (response === undefined) {
      throw new Error(`fetch called ${String(calls + 1)} times, expected ${String(responses.length)}`);
    }
    calls += 1;
    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: { get: (name: string) => response.headers?.[name] ?? null },
      json: () => Promise.resolve(response.body),
    });
  };
  return { fetch, callCount: () => calls };
}

/** A fake clock: records requested waits and resolves instantly — no real timers. */
function fakeSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    waits,
  };
}

describe("bangumi_id validation", () => {
  it("rejects non-numeric bangumi_id in fetchAnitabiPoints", async () => {
    const { fetch } = mockFetch({});
    await expect(fetchAnitabiPoints("abc/123", { fetchImpl: fetch })).rejects.toThrow(
      "Invalid bangumi_id",
    );
  });

  it("rejects non-numeric bangumi_id in fetchAnitabiLite", async () => {
    const { fetch } = mockFetch({});
    await expect(fetchAnitabiLite("../etc", { fetchImpl: fetch })).rejects.toThrow(
      "Invalid bangumi_id",
    );
  });

  it("rejects non-numeric bangumi_id in fetchBangumiSubject", async () => {
    const { fetch } = mockFetch({});
    await expect(fetchBangumiSubject("not-a-number", { fetchImpl: fetch })).rejects.toThrow(
      "Invalid bangumi_id",
    );
  });
});

describe("fetchAnitabiPoints", () => {
  it("hits /{id}/points/detail?haveImage=true and parses a {points:[...]} body", async () => {
    const { fetch, urls } = mockFetch({
      points: [{ id: "p1", name: "鷲宮神社", geo: [36.1, 139.6] }],
    });
    const points = await fetchAnitabiPoints("2461", {
      fetchImpl: fetch,
      anitabiBaseUrl: "https://anitabi.test",
    });
    expect(urls[0]).toBe("https://anitabi.test/2461/points/detail?haveImage=true");
    expect(points).toHaveLength(1);
    expect(points[0]?.id).toBe("p1");
  });

  it("parses a bare-array response shape", async () => {
    const { fetch } = mockFetch([{ id: "p1" }, { id: "p2" }]);
    const points = await fetchAnitabiPoints("3302", { fetchImpl: fetch });
    expect(points).toHaveLength(2);
  });

  it("defaults to the api.anitabi.cn/bangumi base (matches the Python client)", async () => {
    const { fetch, urls } = mockFetch({ points: [] });
    await fetchAnitabiPoints("3302", { fetchImpl: fetch });
    expect(urls[0]).toBe(
      "https://api.anitabi.cn/bangumi/3302/points/detail?haveImage=true",
    );
  });

  it("throws on a non-2xx upstream status", async () => {
    const { fetch } = mockFetch(null, { ok: false, status: 503 });
    await expect(fetchAnitabiPoints("3302", { fetchImpl: fetch })).rejects.toThrow("503");
  });

  it("maps malformed JSON to an Anitabi upstream failure", async () => {
    const fetch: FetchLike = () => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("invalid Anitabi JSON")),
    });

    await expect(fetchAnitabiPoints("3302", { fetchImpl: fetch })).rejects.toEqual(
      expect.objectContaining({ name: UpstreamFetchError.name, upstream: "anitabi" }),
    );
  });
});

describe("fetchAnitabiLite", () => {
  it("hits /{id}/lite and returns litePoints + the total point count", async () => {
    const { fetch, urls } = mockFetch({
      pointsLength: 68,
      litePoints: [{ id: "p1", name: "宇治橋", geo: [34.89, 135.8] }],
    });
    const lite = await fetchAnitabiLite("10380", {
      fetchImpl: fetch,
      anitabiBaseUrl: "https://anitabi.test",
    });
    expect(urls[0]).toBe("https://anitabi.test/10380/lite");
    expect(lite.total).toBe(68);
    expect(lite.points).toHaveLength(1);
    expect(lite.points[0]?.id).toBe("p1");
  });

  it("defaults to the api.anitabi.cn/bangumi base", async () => {
    const { fetch, urls } = mockFetch({ pointsLength: 0, litePoints: [] });
    await fetchAnitabiLite("3302", { fetchImpl: fetch });
    expect(urls[0]).toBe("https://api.anitabi.cn/bangumi/3302/lite");
  });

  it("returns an empty preview defensively when litePoints is missing", async () => {
    const { fetch } = mockFetch({ id: 3302 });
    const lite = await fetchAnitabiLite("3302", { fetchImpl: fetch });
    expect(lite.points).toEqual([]);
    expect(lite.total).toBe(0);
  });

  it("throws on a non-2xx upstream status", async () => {
    const { fetch } = mockFetch(null, { ok: false, status: 503 });
    await expect(fetchAnitabiLite("3302", { fetchImpl: fetch })).rejects.toThrow("503");
  });
});

describe("fetchBangumiSubject", () => {
  it("hits /v0/subjects/{id} and parses the subject object", async () => {
    const { fetch, urls } = mockFetch({ id: 3302, name: "らき☆すた", eps: 24 });
    const subject = await fetchBangumiSubject("3302", {
      fetchImpl: fetch,
      bangumiBaseUrl: "https://bgm.test",
    });
    expect(urls[0]).toBe("https://bgm.test/v0/subjects/3302");
    expect(subject.name).toBe("らき☆すた");
    expect(subject.eps).toBe(24);
  });

  it("throws when the subject response is not a JSON object", async () => {
    const { fetch } = mockFetch([1, 2, 3]);
    await expect(fetchBangumiSubject("3302", { fetchImpl: fetch })).rejects.toThrow(
      "JSON object",
    );
  });
});

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
