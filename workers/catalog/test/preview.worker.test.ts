import { describe, expect, it } from "vitest";
import { previewForQuery, previewForWork } from "../src/api/preview";
import { lenientEgressFetch, stubEgressSigningKey } from "./egress-stub";
import { upstreamUnavailable } from "../src/lib/errors";
import { mockFetchSequence } from "./mock-fetch-sequence";
import { deferred } from "./deferred";
import { unanswered } from "./fakes/unanswered-request";
import type { FetchLike, SourceConfig } from "../src/ingest/sources";

/**
 * Unit tests for the fast Anitabi L1 preview mapping (api/preview.ts).
 *
 * Covers the whole `/lite` mapping chain — litePoint, liteBase, liteGeo,
 * liteImage, liteString, liteInt — which the search tests only reach through
 * an injected `resolvePreview` fake. Here the real fetch chain runs against
 * canned bangumi-search and anitabi-lite bodies, so the field mapping is
 * exercised (not just the empty-preview paths).
 *
 * A caller that cancels during either upstream call gets its own reason back,
 * never the upstream-unavailable error an outage gets.
 */

/** The preview's upstream knobs: the canned fetch behind the egress stand-in, and a fresh signing key. */
function egressCall(fetch: FetchLike): SourceConfig {
  return { fetchImpl: lenientEgressFetch(fetch), egressSigningKey: stubEgressSigningKey() };
}

/** An upstream that never answers: its call ends only when the request's signal aborts, with that reason, as `fetch` does. */
function unansweredUpstream() {
  const arrival = deferred();
  const fetch: FetchLike = (_url, init) => {
    arrival.settle();
    return unanswered(init?.signal ?? AbortSignal.abort(new Error("the upstream call carried no signal")));
  };
  return { fetch, called: arrival.promise };
}

const SEARCH_BODY = { data: [{ id: 10380 }] };
const SEARCH_EMPTY = { data: [] };

/** A real Anitabi `/lite` point body, official geo[] schema. */
const LITE_POINTS = [
  {
    id: "p1",
    name: "宇治橋",
    geo: [34.8915, 135.8078],
    image: "/lite/p1.jpg",
    ep: 1,
    s: 12,
    origin: "バンダイチャンネル",
    originURL: "https://www.b-ch.com/ttl/index.php?ttl_c=1",
  },
  {
    id: "p2",
    name: "平等院",
    geo: ["34.8898", "135.8071"],
    image: "https://cdn.example/lite/p2.jpg",
  },
];

/** {@link LITE_POINTS} on the point contract for work 10380: p1's relative image gains the image
 * host and its origin text is kept; p2's absolute image and string geo come through as values. */
const MAPPED_LITE_POINTS = [
  {
    id: "p1",
    name: "宇治橋",
    bangumi_id: "10380",
    screenshot_url: "https://image.anitabi.cn/lite/p1.jpg",
    latitude: 34.8915,
    longitude: 135.8078,
    episode: 1,
    time_seconds: 12,
    origin: "バンダイチャンネル",
    origin_url: "https://www.b-ch.com/ttl/index.php?ttl_c=1",
  },
  {
    id: "p2",
    name: "平等院",
    bangumi_id: "10380",
    screenshot_url: "https://cdn.example/lite/p2.jpg",
    latitude: 34.8898,
    longitude: 135.8071,
  },
];

describe("previewForQuery (api/preview.ts)", () => {
  it("resolves a title and maps every lite point onto the point contract", async () => {
    const { fetch } = mockFetchSequence([
      { status: 200, body: SEARCH_BODY },
      { status: 200, body: { pointsLength: 2, litePoints: LITE_POINTS } },
    ]);

    const preview = await previewForQuery("けいおん！", egressCall(fetch));

    expect(preview?.bangumiId).toBe("10380");
    expect(preview?.points).toEqual(MAPPED_LITE_POINTS);
  });

  it("returns null when the title resolves to no bangumi subject", async () => {
    const { fetch } = mockFetchSequence([{ status: 200, body: SEARCH_EMPTY }]);
    expect(await previewForQuery("nothing here", egressCall(fetch))).toBeNull();
  });

  it("returns null when the work has an empty lite preview", async () => {
    const { fetch } = mockFetchSequence([
      { status: 200, body: SEARCH_BODY },
      { status: 200, body: { pointsLength: 0, litePoints: [] } },
    ]);
    expect(await previewForQuery("けいおん！", egressCall(fetch))).toBeNull();
  });
});

describe("previewForWork (api/preview.ts)", () => {
  it("maps every lite point of the work onto the point contract", async () => {
    const { fetch } = mockFetchSequence([{ status: 200, body: { pointsLength: 2, litePoints: LITE_POINTS } }]);
    const preview = await previewForWork("10380", egressCall(fetch));
    expect(preview).toEqual({ bangumiId: "10380", points: MAPPED_LITE_POINTS });
  });

  it("normalizes geo to numbers, falling back to 0,0 on malformed entries", async () => {
    const { fetch } = mockFetchSequence([
      {
        status: 200,
        body: { pointsLength: 1, litePoints: [{ id: "p3", name: "bad", geo: "not-an-array" }] },
      },
    ]);

    const preview = await previewForWork("10380", egressCall(fetch));

    expect(preview.points).toEqual([
      { id: "p3", name: "bad", bangumi_id: "10380", screenshot_url: "", latitude: 0, longitude: 0 },
    ]);
  });

  it("treats an Anitabi 404 as an empty preview, not an outage", async () => {
    const { fetch } = mockFetchSequence([{ status: 404, body: null }]);
    const preview = await previewForWork("10380", egressCall(fetch));
    expect(preview).toEqual({ bangumiId: "10380", points: [] });
  });

  it("maps an Anitabi outage to a typed retryable upstream error", async () => {
    const { fetch } = mockFetchSequence([{ status: 503, body: null }]);
    await expect(previewForWork("10380", egressCall(fetch))).rejects.toEqual(
      upstreamUnavailable("anitabi", expect.anything() as unknown),
    );
  });

  it("rounds fractional episode/timing values with truncation", async () => {
    const { fetch } = mockFetchSequence([
      {
        status: 200,
        body: {
          pointsLength: 1,
          litePoints: [{ id: "p4", name: "trunc", geo: [1.1, 2.2], ep: 3.9, s: 7.7 }],
        },
      },
    ]);

    const preview = await previewForWork("10380", egressCall(fetch));

    expect(preview.points[0]).toMatchObject({ episode: 3, time_seconds: 7 });
  });
});

describe("a caller's cancel through the preview (api/preview.ts)", () => {
  it("previewForQuery rejects with the caller's own reason when the caller cancels the Bangumi search", async () => {
    const caller = new AbortController();
    const reason = new Error("the edge gave up");
    const upstream = unansweredUpstream();
    const preview = previewForQuery("けいおん！", { ...egressCall(upstream.fetch), signal: caller.signal });
    await upstream.called;
    caller.abort(reason);
    await expect(preview).rejects.toBe(reason);
    await expect(preview).rejects.not.toEqual(upstreamUnavailable("bangumi", expect.anything() as unknown));
  });

  it("previewForWork rejects with the caller's own reason when the caller cancels the Anitabi fetch", async () => {
    const caller = new AbortController();
    const reason = new Error("the edge gave up");
    const upstream = unansweredUpstream();
    const preview = previewForWork("10380", { ...egressCall(upstream.fetch), signal: caller.signal });
    await upstream.called;
    caller.abort(reason);
    await expect(preview).rejects.toBe(reason);
    await expect(preview).rejects.not.toEqual(upstreamUnavailable("anitabi", expect.anything() as unknown));
  });
});
