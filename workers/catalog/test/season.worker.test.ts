/**
 * Unit tests for the current-season fetcher (catalog/src/ingest/season.ts).
 * An injected mock `fetch` keeps these off the network: each test feeds a canned
 * Bangumi calendar body and asserts the endpoint, dedup, and resilience.
 */
import { describe, expect, it } from "vitest";
import { fetchCurrentSeason } from "../src/ingest/season";
import { mockFetch } from "./mock-fetch-sequence";

describe("fetchCurrentSeason", () => {
  it("hits /calendar and flattens the week's subject ids", async () => {
    const { fetch, urls } = mockFetch([
      { weekday: { en: "mon" }, items: [{ id: 101, name: "A" }, { id: "102", name: "B" }] },
      { weekday: { en: "tue" }, items: [{ id: 103, name: "C" }] },
    ]);
    const ids = await fetchCurrentSeason({ fetchImpl: fetch, bangumiBaseUrl: "https://bgm.test" });
    expect(urls[0]).toBe("https://bgm.test/calendar");
    expect(ids).toEqual(["101", "102", "103"]);
  });

  it("defaults to the api.bgm.tv base (matches the Python client)", async () => {
    const { fetch, urls } = mockFetch([{ weekday: { en: "mon" }, items: [{ id: 1 }] }]);
    await fetchCurrentSeason({ fetchImpl: fetch });
    expect(urls[0]).toBe("https://api.bgm.tv/calendar");
  });

  it("deduplicates ids that appear across weekday buckets", async () => {
    const { fetch } = mockFetch([
      { weekday: { en: "mon" }, items: [{ id: 9 }, { id: 10 }] },
      { weekday: { en: "tue" }, items: [{ id: 10 }, { id: 11 }] },
    ]);
    const ids = await fetchCurrentSeason({ fetchImpl: fetch });
    expect(ids).toEqual(["9", "10", "11"]);
  });

  it("yields an empty season on a malformed or empty calendar body", async () => {
    const { fetch } = mockFetch({ not: "a calendar" });
    await expect(fetchCurrentSeason({ fetchImpl: fetch })).resolves.toEqual([]);
    const { fetch: empty } = mockFetch([]);
    await expect(fetchCurrentSeason({ fetchImpl: empty })).resolves.toEqual([]);
  });

  it("throws on a non-2xx upstream status", async () => {
    const { fetch } = mockFetch(null, { ok: false, status: 503 });
    await expect(fetchCurrentSeason({ fetchImpl: fetch })).rejects.toThrow(/503/);
  });
});
