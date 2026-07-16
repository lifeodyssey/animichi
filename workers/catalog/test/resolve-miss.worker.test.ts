import { describe, expect, it } from "vitest";
import { resolve, type ResolveDb } from "../src/api/resolve";
import type { FetchLike } from "../src/ingest/sources";

const MISS_DB: ResolveDb = {
  worksForAlias: () => Promise.resolve([]),
  candidatesForWorks: () => Promise.reject(new Error("catalog candidates must not load on MISS")),
};

function response(body: unknown, status = 200): FetchLike {
  return () => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

function subject(id: number, name: string, name_cn?: string): Record<string, unknown> {
  return { id, name, name_cn };
}

describe("resolve alias MISS outcome partition", () => {
  it("returns not_found when Bangumi returns zero subjects", async () => {
    await expect(resolve(MISS_DB, { query: "unknown" }, {
      fetchImpl: response({ data: [] }),
    })).resolves.toEqual({ outcome: "not_found", reason: "anime_not_found" });
  });

  it("clarifies two normalized-name-exact Bangumi subjects", async () => {
    const data = [subject(1, "ＦＡＴＥ"), subject(2, "Fate/Zero", "Fate")];

    const result = await resolve(MISS_DB, { query: " fate " }, {
      fetchImpl: response({ data }),
    });
    expect(result).toMatchObject({
      outcome: "needs_disambiguation",
      reason: "anime_ambiguity",
      candidates: [{ bangumi_id: "1" }, { bangumi_id: "2" }],
    });
  });

  it("resolves the relevance head when multiple subjects are only soft matches", async () => {
    const data = [subject(10, "Fate/stay night"), subject(20, "Fate/Zero")];

    await expect(resolve(MISS_DB, { query: "Fate series" }, {
      fetchImpl: response({ data }),
    })).resolves.toMatchObject({
      outcome: "resolved",
      match: { bangumi_id: "10", title: "Fate/stay night" },
    });
  });
});

describe("resolve alias MISS subject parsing", () => {
  it("parses cover from images and prefers date when deriving year", async () => {
    const data = [{
      id: 30,
      name: "Image Anime",
      images: { common: "https://img.test/common.jpg" },
      date: "2024-04-01",
      air_date: "1999-01-01",
    }];

    await expect(resolve(MISS_DB, { query: "image" }, {
      fetchImpl: response({ data }),
    })).resolves.toEqual({
      outcome: "resolved",
      match: {
        bangumi_id: "30",
        title: "Image Anime",
        cover_url: "https://img.test/common.jpg",
        year: 2024,
      },
    });
  });

  it("keeps an air_date-only subject while ignoring the non-v0 image field", async () => {
    const data = [{ id: 40, name: "Fallback Anime", image: "wrong.jpg", air_date: "2012-07-06" }];

    await expect(resolve(MISS_DB, { query: "fallback" }, {
      fetchImpl: response({ data }),
    })).resolves.toEqual({
      outcome: "resolved",
      match: { bangumi_id: "40", title: "Fallback Anime", year: 2012 },
    });
  });

  it("skips a nameless subject without discarding valid relevance-ordered results", async () => {
    const data = [subject(50, "Fate/stay night"), { id: 51 }, subject(52, "Fate/Zero")];

    await expect(resolve(MISS_DB, { query: "Fate series" }, {
      fetchImpl: response({ data }),
    })).resolves.toMatchObject({
      outcome: "resolved",
      match: { bangumi_id: "50", title: "Fate/stay night" },
    });
  });
});

describe("resolve alias MISS outages", () => {
  it("surfaces a Bangumi network failure as upstream_unavailable", async () => {
    const networkFailure: FetchLike = () => Promise.reject(new Error("network down"));

    await expect(resolve(MISS_DB, { query: "outage" }, {
      fetchImpl: networkFailure,
    })).resolves.toEqual({ outcome: "upstream_unavailable", provider: "bangumi" });
  });

  it("surfaces Bangumi 5xx as upstream_unavailable", async () => {
    await expect(resolve(MISS_DB, { query: "outage" }, {
      fetchImpl: response(null, 503),
    })).resolves.toEqual({ outcome: "upstream_unavailable", provider: "bangumi" });
  });

  it("surfaces malformed Bangumi JSON as upstream_unavailable", async () => {
    const invalidJson: FetchLike = () => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("invalid Bangumi JSON")),
    });

    await expect(resolve(MISS_DB, { query: "broken" }, {
      fetchImpl: invalidJson,
    })).resolves.toEqual({ outcome: "upstream_unavailable", provider: "bangumi" });
  });
});
