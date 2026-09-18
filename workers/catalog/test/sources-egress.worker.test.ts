import { describe, expect, it } from "vitest";
import {
  fetchAnitabiLite,
  fetchAnitabiPoints,
  UpstreamRefusedError,
  type FetchLike,
} from "../src/ingest/sources";
import { ANITABI_EGRESS_BASE_URL } from "../src/ingest/anitabi-egress";
import {
  lenientEgressFetch,
  strictEgressFetch,
  stubEgressSigningKey,
} from "./egress-stub";
import { fakeSleep, mockFetch } from "./mock-fetch-sequence";

/**
 * `sources.ts` against a stubbed egress service (#1792): the two operations
 * work through the service, the outgoing request is signed the way the service
 * demands, and the three failure worlds stay distinguishable — upstream
 * refusal, upstream fault, our own egress refusing. No test here reaches the
 * real anitabi API; the stub is the service's contract.
 *
 * The base URL is not injected: the tests read the one the code built, which is
 * how they prove the destination is a constant rather than a parameter.
 */

const POINTS_BODY = { points: [{ id: "p1", name: "鷲宮神社", geo: [36.1, 139.6] }] };

describe("the two operations through the egress", () => {
  it("fetchAnitabiPoints calls the egress points operation", async () => {
    const { fetch, urls } = mockFetch(POINTS_BODY);
    const points = await fetchAnitabiPoints("2461", {
      fetchImpl: lenientEgressFetch(fetch),
      egressSigningKey: stubEgressSigningKey(),
    });
    expect(urls[0]).toBe(`${ANITABI_EGRESS_BASE_URL}/anitabi/points/2461`);
    expect(points).toHaveLength(1);
    expect(points[0]?.id).toBe("p1");
  });

  it("fetchAnitabiLite calls the egress lite operation", async () => {
    const { fetch, urls } = mockFetch({ pointsLength: 68, litePoints: [{ id: "p1" }] });
    const lite = await fetchAnitabiLite("10380", {
      fetchImpl: lenientEgressFetch(fetch),
      egressSigningKey: stubEgressSigningKey(),
    });
    expect(urls[0]).toBe(`${ANITABI_EGRESS_BASE_URL}/anitabi/lite/10380`);
    expect(lite.total).toBe(68);
  });

  it("never names api.anitabi.cn — the upstream is reachable only through the service", async () => {
    const { fetch, urls } = mockFetch(POINTS_BODY);
    await fetchAnitabiPoints("2461", {
      fetchImpl: lenientEgressFetch(fetch),
      egressSigningKey: stubEgressSigningKey(),
    });
    expect(urls[0]).not.toContain("api.anitabi.cn");
    expect(urls[0]?.startsWith(ANITABI_EGRESS_BASE_URL)).toBe(true);
  });
});

describe("the outgoing request is signed as the service demands", () => {
  it("carries a timestamp and a signature the service verifies", async () => {
    const signingKey = stubEgressSigningKey();
    const seen: { url: string; timestamp?: string; signature?: string }[] = [];
    const inner: FetchLike = (url, init) => {
      seen.push({ url, timestamp: init?.headers?.["x-egress-timestamp"], signature: init?.headers?.["x-egress-signature"] });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(POINTS_BODY) });
    };
    await fetchAnitabiPoints("2461", {
      fetchImpl: strictEgressFetch(signingKey, inner),
      egressSigningKey: signingKey,
      nowMs: () => 1_700_000_000_000,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`${ANITABI_EGRESS_BASE_URL}/anitabi/points/2461`);
    expect(seen[0]?.timestamp).toBe("1700000000");
    expect(seen[0]?.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a mangled key is refused by the service and surfaces as an egress refusal", async () => {
    const signingKey = stubEgressSigningKey();
    let upstreamCalls = 0;
    const inner: FetchLike = () => {
      upstreamCalls += 1;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(POINTS_BODY) });
    };
    await expect(
      fetchAnitabiLite("2461", {
        fetchImpl: strictEgressFetch("not-the-key", inner),
        egressSigningKey: signingKey,
      }),
    ).rejects.toEqual(expect.objectContaining({ name: "EgressRefusedError", reason: "auth" }));
    expect(upstreamCalls).toBe(0);
  });
});

describe("a relayed upstream answer keeps the upstream's own meaning", () => {
  it("an upstream 403 relayed by the service stays an upstream refusal", async () => {
    const { fetch } = mockFetch(null, { ok: false, status: 403 });
    await expect(
      fetchAnitabiPoints("2461", {
        fetchImpl: lenientEgressFetch(fetch),
        egressSigningKey: stubEgressSigningKey(),
      }),
    ).rejects.toEqual(expect.objectContaining({ name: UpstreamRefusedError.name }));
  });

  it("a relayed upstream 429 is the upstream's, and still retries with backoff", async () => {
    let upstreamCalls = 0;
    const liteBody = { pointsLength: 1, litePoints: [{ id: "p1" }] };
    const retryable: FetchLike = () => {
      upstreamCalls += 1;
      const marker = { get: (name: string) => (name === "x-egress-response" ? "relayed-upstream" : null) };
      return upstreamCalls < 3
        ? Promise.resolve({ ok: false, status: 429, headers: marker, json: () => Promise.resolve(null) })
        : Promise.resolve({ ok: true, status: 200, headers: marker, json: () => Promise.resolve(liteBody) });
    };
    const { sleep, waits } = fakeSleep();
    const lite = await fetchAnitabiLite("2461", {
      fetchImpl: retryable,
      egressSigningKey: stubEgressSigningKey(),
      retry: { sleep, jitterMs: () => 0 },
    });
    expect(upstreamCalls).toBe(3);
    expect(waits).toHaveLength(2);
    expect(lite.total).toBe(1);
  });
});

describe("this service's own refusals are never mistaken for the upstream's", () => {
  it("the egress's own ceiling refusal is ours, and is never retried in-request", async () => {
    let upstreamCalls = 0;
    const ceilingFetch: FetchLike = () => {
      upstreamCalls += 1;
      return Promise.resolve({
        ok: false,
        status: 429,
        headers: { get: (name: string) => (name === "x-egress-response" ? "refused-here" : name === "x-egress-refusal" ? "ceiling" : null) },
        json: () => Promise.resolve({ reason: "ceiling" }),
      });
    };
    const { sleep, waits } = fakeSleep();
    await expect(
      fetchAnitabiLite("2461", {
        fetchImpl: ceilingFetch,
        egressSigningKey: stubEgressSigningKey(),
        retry: { sleep, attempts: 3 },
      }),
    ).rejects.toEqual(expect.objectContaining({ name: "EgressRefusedError", reason: "ceiling" }));
    expect(upstreamCalls).toBe(1);
    expect(waits).toEqual([]);
  });

  it("a response with no egress marker is refused as not-ours", async () => {
    const { fetch } = mockFetch(POINTS_BODY);
    await expect(
      fetchAnitabiPoints("2461", { fetchImpl: fetch, egressSigningKey: stubEgressSigningKey() }),
    ).rejects.toEqual(expect.objectContaining({ name: "EgressRefusedError" }));
  });
});

describe("fail closed on missing configuration", () => {
  it("refuses the points fetch when no signing key is configured", async () => {
    const { fetch, urls } = mockFetch(POINTS_BODY);
    await expect(fetchAnitabiPoints("2461", { fetchImpl: fetch })).rejects.toThrow(
      /anitabi egress is not configured/,
    );
    expect(urls).toEqual([]);
  });

  it("refuses the lite fetch when no signing key is configured", async () => {
    const { fetch, urls } = mockFetch(POINTS_BODY);
    await expect(fetchAnitabiLite("2461", { fetchImpl: fetch })).rejects.toThrow(
      /INGEST_SIGNING_KEY/,
    );
    expect(urls).toEqual([]);
  });
});
