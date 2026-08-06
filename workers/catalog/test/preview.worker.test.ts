import { describe, expect, it } from "vitest";
import { previewForQuery, previewForWork } from "../src/api/preview";
import { upstreamUnavailable } from "../src/lib/errors";
import { mockFetchSequence } from "./mock-fetch-sequence";

/**
 * Unit tests for the fast Anitabi L1 preview mapping (api/preview.ts).
 *
 * Covers the whole `/lite` mapping chain — litePoint, liteBase, liteGeo,
 * liteImage, liteString, liteInt — which the search tests only reach through
 * an injected `resolvePreview` fake. Here the real fetch chain runs against
 * canned bangumi-search and anitabi-lite bodies, so the field mapping is
 * exercised (not just the empty-preview paths).
 */

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
  },
  {
    id: "p2",
    name: "平等院",
    geo: ["34.8898", "135.8071"],
    image: "https://cdn.example/lite/p2.jpg",
  },
];

describe("previewForQuery (api/preview.ts)", () => {
  it("resolves a title and maps every lite point onto the point contract", async () => {
    const { fetch } = mockFetchSequence([
      { status: 200, body: SEARCH_BODY },
      { status: 200, body: { pointsLength: 2, litePoints: LITE_POINTS } },
    ]);

    const preview = await previewForQuery("けいおん！", fetch);

    expect(preview?.workId).toBe("10380");
    expect(preview?.points).toEqual([
      {
        id: "p1",
        name: "宇治橋",
        bangumi_id: "10380",
        screenshot_url: "https://image.anitabi.cn/lite/p1.jpg",
        latitude: 34.8915,
        longitude: 135.8078,
        episode: 1,
        time_seconds: 12,
      },
      {
        id: "p2",
        name: "平等院",
        bangumi_id: "10380",
        screenshot_url: "https://cdn.example/lite/p2.jpg",
        latitude: 34.8898,
        longitude: 135.8071,
      },
    ]);
  });

  it("returns null when the title resolves to no bangumi subject", async () => {
    const { fetch } = mockFetchSequence([{ status: 200, body: SEARCH_EMPTY }]);
    expect(await previewForQuery("nothing here", fetch)).toBeNull();
  });

  it("returns null when the work has an empty lite preview", async () => {
    const { fetch } = mockFetchSequence([
      { status: 200, body: SEARCH_BODY },
      { status: 200, body: { pointsLength: 0, litePoints: [] } },
    ]);
    expect(await previewForQuery("けいおん！", fetch)).toBeNull();
  });
});

describe("previewForWork (api/preview.ts)", () => {
  it("normalizes geo to numbers, falling back to 0,0 on malformed entries", async () => {
    const { fetch } = mockFetchSequence([
      {
        status: 200,
        body: { pointsLength: 1, litePoints: [{ id: "p3", name: "bad", geo: "not-an-array" }] },
      },
    ]);

    const preview = await previewForWork("10380", fetch);

    expect(preview.points).toEqual([
      { id: "p3", name: "bad", bangumi_id: "10380", screenshot_url: "", latitude: 0, longitude: 0 },
    ]);
  });

  it("treats an Anitabi 404 as an empty preview, not an outage", async () => {
    const { fetch } = mockFetchSequence([{ status: 404, body: null }]);
    const preview = await previewForWork("10380", fetch);
    expect(preview).toEqual({ workId: "10380", points: [] });
  });

  it("maps an Anitabi outage to a typed retryable upstream error", async () => {
    const { fetch } = mockFetchSequence([{ status: 503, body: null }]);
    await expect(previewForWork("10380", fetch)).rejects.toEqual(
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

    const preview = await previewForWork("10380", fetch);

    expect(preview.points[0]).toMatchObject({ episode: 3, time_seconds: 7 });
  });
});
