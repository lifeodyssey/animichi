import { describe, expect, it } from "vitest";
import {
  resolveBangumi,
  type TitleAliasPort,
  type UpstreamTitlePort,
} from "../src/application/resolve-bangumi";

type Subject = Record<string, unknown> & { id: string };

function upstreamWith(subjects: Subject[]): UpstreamTitlePort {
  return { fetchSubjects: () => Promise.resolve(subjects) };
}

function subject(id: number, name: string, name_cn?: string): Subject {
  return { id: String(id), name, name_cn };
}

const EMPTY_ALIAS: TitleAliasPort = {
  worksForAlias: () => Promise.resolve([]),
  candidatesForWorks: () => Promise.reject(new Error("catalog candidates must not load on MISS")),
};

describe("resolveBangumi upstream miss outcomes", () => {
  it("falls through to upstream when every alias work is orphaned", async () => {
    const alias: TitleAliasPort = {
      worksForAlias: () => Promise.resolve([{ bangumi_id: "missing", priority: 40 }]),
      candidatesForWorks: () => Promise.resolve([]),
    };

    await expect(resolveBangumi(alias, upstreamWith([]), { query: "Stale Alias" })).resolves.toEqual({
      outcome: "not_found",
      reason: "anime_not_found",
    });
  });

  it("returns not_found when upstream returns zero subjects", async () => {
    await expect(resolveBangumi(EMPTY_ALIAS, upstreamWith([]), { query: "unknown" })).resolves.toEqual({
      outcome: "not_found",
      reason: "anime_not_found",
    });
  });

  it("clarifies name-similar subjects in upstream relevance order", async () => {
    const subjects = [
      subject(1, "涼宮ハルヒの憂鬱", "凉宫春日的忧郁"),
      subject(2, "凉宫ハルヒの消失"),
      subject(3, "日常"),
    ];

    await expect(resolveBangumi(EMPTY_ALIAS, upstreamWith(subjects), { query: "凉宫" })).resolves.toMatchObject({
      outcome: "needs_disambiguation",
      reason: "anime_ambiguity",
      candidates: [{ bangumi_id: "1" }, { bangumi_id: "2" }],
    });
  });

  it("resolves the only name-similar subject instead of the relevance head", async () => {
    const subjects = [subject(10, "Puella Magi Madoka Magica"), subject(20, "Fate/Zero")];

    await expect(resolveBangumi(EMPTY_ALIAS, upstreamWith(subjects), { query: "fate" })).resolves.toMatchObject({
      outcome: "resolved",
      match: { bangumi_id: "20", title: "Fate/Zero" },
    });
  });

  it("resolves the relevance head when no subject name is similar", async () => {
    const subjects = [subject(10, "Fate/stay night"), subject(20, "Fate/Zero")];

    await expect(resolveBangumi(EMPTY_ALIAS, upstreamWith(subjects), { query: "unrelated search" }))
      .resolves.toMatchObject({ outcome: "resolved", match: { bangumi_id: "10" } });
  });
});

describe("resolveBangumi upstream similarity guards", () => {
  it("matches a one-character query by exact equality only", async () => {
    const subjects = [subject(10, "Attack on Titan"), subject(20, "K"), subject(30, "K-On!")];

    await expect(resolveBangumi(EMPTY_ALIAS, upstreamWith(subjects), { query: "k" })).resolves.toMatchObject({
      outcome: "resolved",
      match: { bangumi_id: "20" },
    });
  });

  it("blocks long-query reverse matches against short fetched titles", async () => {
    const subjects = [
      subject(10, "Fallback Anime"),
      subject(20, "K"),
      subject(30, "C"),
      subject(40, "86"),
    ];

    await expect(resolveBangumi(EMPTY_ALIAS, upstreamWith(subjects), {
      query: "Please find K, C, and 86 anime for my long vacation",
    })).resolves.toMatchObject({ outcome: "resolved", match: { bangumi_id: "10" } });
  });

  it("keeps an in-ratio reverse match", async () => {
    const subjects = [subject(10, "Relevance Head"), subject(20, "Fate")];

    await expect(resolveBangumi(EMPTY_ALIAS, upstreamWith(subjects), { query: "Fate extra" })).resolves.toMatchObject({
      outcome: "resolved",
      match: { bangumi_id: "20" },
    });
  });
});

describe("resolveBangumi upstream subject parsing", () => {
  it("parses cover from images and prefers date when deriving year", async () => {
    const subjects = [{
      id: "30",
      name: "Image Anime",
      images: { common: "https://img.test/common.jpg" },
      date: "2024-04-01",
      air_date: "1999-01-01",
    }];

    await expect(resolveBangumi(EMPTY_ALIAS, upstreamWith(subjects), { query: "image" })).resolves.toEqual({
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
    const subjects = [{ id: "40", name: "Fallback Anime", image: "wrong.jpg", air_date: "2012-07-06" }];

    await expect(resolveBangumi(EMPTY_ALIAS, upstreamWith(subjects), { query: "fallback" })).resolves.toEqual({
      outcome: "resolved",
      match: { bangumi_id: "40", title: "Fallback Anime", year: 2012 },
    });
  });

  it("skips a nameless subject without discarding valid relevance-ordered results", async () => {
    const subjects = [subject(50, "Fate/stay night"), { id: "51" }, subject(52, "Fate/Zero")];

    await expect(resolveBangumi(EMPTY_ALIAS, upstreamWith(subjects), { query: "Fate series" })).resolves.toMatchObject({
      outcome: "resolved",
      match: { bangumi_id: "50" },
    });
  });
});

describe("resolveBangumi upstream failure", () => {
  it("surfaces the typed upstream_unavailable sentinel from the port", async () => {
    const upstream: UpstreamTitlePort = {
      fetchSubjects: () => Promise.resolve("upstream_unavailable" as const),
    };

    await expect(resolveBangumi(EMPTY_ALIAS, upstream, { query: "outage" })).resolves.toEqual({
      outcome: "upstream_unavailable",
      provider: "bangumi",
    });
  });
});
