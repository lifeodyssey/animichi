import { describe, expect, it } from "vitest";
import {
  fetchAnitabiLite,
  fetchAnitabiPoints,
  fetchBangumiSubject,
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
