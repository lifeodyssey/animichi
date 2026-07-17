import { describe, expect, it } from "vitest";
import {
  fetchBangumiSearch,
  fetchBangumiSubjects,
  type FetchLike,
} from "../src/ingest/sources";

function recorder(body: unknown): { fetchImpl: FetchLike; urls: string[]; bodies: string[] } {
  const urls: string[] = [];
  const bodies: string[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    urls.push(url);
    bodies.push(init?.body ?? "");
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  return { fetchImpl, urls, bodies };
}

describe("fetchBangumiSubjects", () => {
  it("requests the configured result count and preserves relevance order", async () => {
    const source = recorder({ data: [{ id: 20, name: "Head" }, { id: "10", name: "Second" }] });

    const subjects = await fetchBangumiSubjects("Fate", {
      fetchImpl: source.fetchImpl,
      bangumiBaseUrl: "https://bgm.test",
      limit: 8,
    });
    expect(source.urls).toEqual(["https://bgm.test/v0/search/subjects?limit=8&offset=0"]);
    expect(JSON.parse(source.bodies[0] ?? "")).toEqual({ keyword: "Fate", filter: { type: [2] } });
    expect(subjects.map((item) => item.id)).toEqual(["20", "10"]);
  });

  it("keeps fetchBangumiSearch as a limit-one relevance-head wrapper", async () => {
    const source = recorder({ data: [{ id: 20, name: "Head" }, { id: 10, name: "Second" }] });

    await expect(fetchBangumiSearch("Fate", {
      fetchImpl: source.fetchImpl,
      bangumiBaseUrl: "https://bgm.test",
    })).resolves.toBe("20");
    expect(source.urls[0]).toContain("limit=1");
  });
});
