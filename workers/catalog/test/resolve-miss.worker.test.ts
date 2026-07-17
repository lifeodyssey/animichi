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

  it("clarifies name-similar 凉宫 subjects in Bangumi relevance order", async () => {
    const data = [
      subject(1, "涼宮ハルヒの憂鬱", "凉宫春日的忧郁"),
      subject(2, "凉宫ハルヒの消失"),
      subject(3, "日常"),
    ];

    const result = await resolve(MISS_DB, { query: "凉宫" }, {
      fetchImpl: response({ data }),
    });
    expect(result).toMatchObject({
      outcome: "needs_disambiguation",
      reason: "anime_ambiguity",
      candidates: [{ bangumi_id: "1" }, { bangumi_id: "2" }],
    });
  });

  it("resolves the only name-similar subject instead of the relevance head", async () => {
    const data = [subject(10, "Puella Magi Madoka Magica"), subject(20, "Fate/Zero")];

    await expect(resolve(MISS_DB, { query: "fate" }, {
      fetchImpl: response({ data }),
    })).resolves.toMatchObject({
      outcome: "resolved",
      match: { bangumi_id: "20", title: "Fate/Zero" },
    });
  });

  it("resolves the relevance head when no subject name is similar", async () => {
    const data = [subject(10, "Fate/stay night"), subject(20, "Fate/Zero")];

    await expect(resolve(MISS_DB, { query: "unrelated search" }, {
      fetchImpl: response({ data }),
    })).resolves.toMatchObject({
      outcome: "resolved",
      match: { bangumi_id: "10", title: "Fate/stay night" },
    });
  });
});

describe("resolve alias MISS candidate bounds and degenerate inputs", () => {
  it("caps name-similar subjects at six in stable relevance order", async () => {
    const data = Array.from({ length: 8 }, (_, index) => subject(index + 1, `凉宫 ${String(index + 1)}`));

    await expect(resolve(MISS_DB, { query: "凉宫" }, {
      fetchImpl: response({ data }),
    })).resolves.toMatchObject({
      outcome: "needs_disambiguation",
      candidates: [1, 2, 3, 4, 5, 6].map((id) => ({ bangumi_id: String(id) })),
    });
  });

  it("head-picks when the normalized query is empty", async () => {
    const data = [subject(10, "   ", "Fallback Anime"), subject(20, "Another Anime")];

    await expect(resolve(MISS_DB, { query: "   " }, {
      fetchImpl: response({ data }),
    })).resolves.toMatchObject({
      outcome: "resolved",
      match: { bangumi_id: "10", title: "Fallback Anime" },
    });
  });
});

describe("resolve alias MISS informativeness guards", () => {
  it("matches a one-character query by exact equality only", async () => {
    const data = [subject(10, "Attack on Titan"), subject(20, "K"), subject(30, "K-On!")];

    await expect(resolve(MISS_DB, { query: "k" }, {
      fetchImpl: response({ data }),
    })).resolves.toMatchObject({
      outcome: "resolved",
      match: { bangumi_id: "20", title: "K" },
    });
  });

  it("blocks long-query reverse matches against short fetched titles", async () => {
    const data = [
      subject(10, "Fallback Anime"),
      subject(20, "K"),
      subject(30, "C"),
      subject(40, "86"),
    ];

    await expect(resolve(MISS_DB, { query: "Please find K, C, and 86 anime for my long vacation" }, {
      fetchImpl: response({ data }),
    })).resolves.toMatchObject({
      outcome: "resolved",
      match: { bangumi_id: "10", title: "Fallback Anime" },
    });
  });

  it("keeps an in-ratio reverse match", async () => {
    const data = [subject(10, "Relevance Head"), subject(20, "Fate")];

    await expect(resolve(MISS_DB, { query: "Fate extra" }, {
      fetchImpl: response({ data }),
    })).resolves.toMatchObject({
      outcome: "resolved",
      match: { bangumi_id: "20", title: "Fate" },
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
