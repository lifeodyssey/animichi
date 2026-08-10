import { describe, expect, it, vi } from "vitest";
import {
  MAX_CANDIDATES,
  resolveBangumi,
  type AliasWork,
  type ResolveObserverPort,
  type ResolveObservation,
  type TitleAliasPort,
  type UpstreamTitlePort,
} from "../src/application/resolve-bangumi";
import type { AnimeCandidate } from "../src/types";

type Subject = Record<string, unknown> & { id: string };

function candidate(id: string, points_count?: number): AnimeCandidate {
  return { bangumi_id: id, title: `Anime ${id}`, points_count };
}

function aliasWith(works: AliasWork[], candidates: AnimeCandidate[]): TitleAliasPort {
  return {
    worksForAlias: () => Promise.resolve(works),
    candidatesForWorks: (ids) => Promise.resolve(candidates.filter((item) => ids.includes(item.bangumi_id))),
  };
}

function upstreamWith(subjects: Subject[]): UpstreamTitlePort {
  return { fetchSubjects: () => Promise.resolve(subjects) };
}

function subject(id: number, name: string, name_cn?: string): Subject {
  return { id: String(id), name, name_cn };
}

const EMPTY_ALIAS = aliasWith([], []);

describe("resolveBangumi exact-first sequencing", () => {
  it("resolves from the alias index without consulting upstream", async () => {
    const upstream: UpstreamTitlePort = {
      fetchSubjects: () => Promise.reject(new Error("upstream must not run")),
    };
    const alias = aliasWith([{ bangumi_id: "3302", priority: 40 }], [candidate("3302", 2)]);

    await expect(resolveBangumi(alias, upstream, { query: "Lucky Star" })).resolves.toEqual({
      outcome: "resolved",
      match: candidate("3302", 2),
    });
  });

  it("consults upstream only after an exact alias miss", async () => {
    const fetchSubjects = vi.fn(() => Promise.resolve([subject(10, "Fate/Zero")]));

    const result = await resolveBangumi(
      EMPTY_ALIAS,
      { fetchSubjects },
      { query: "unrelated search" },
    );
    expect(result).toMatchObject({ outcome: "resolved", match: { bangumi_id: "10" } });
    expect(fetchSubjects).toHaveBeenCalledTimes(1);
  });
});

describe("resolveBangumi alias-hit deduplication and ties", () => {
  it("deduplicates duplicate alias rows for one work before deciding ambiguity", async () => {
    const alias = aliasWith(
      [{ bangumi_id: "3302", priority: 40 }, { bangumi_id: "3302", priority: 40 }],
      [candidate("3302", 2)],
    );

    await expect(resolveBangumi(alias, upstreamWith([]), { query: "Lucky Star" })).resolves.toEqual({
      outcome: "resolved",
      match: candidate("3302", 2),
    });
  });

  it("resolves one work reached through multiple source alias priorities", async () => {
    const alias = aliasWith(
      [{ bangumi_id: "10380", priority: 40 }, { bangumi_id: "10380", priority: 30 }],
      [candidate("10380", 0)],
    );

    const result = await resolveBangumi(alias, upstreamWith([]), { query: "K-On" });
    expect(result.outcome).toBe("resolved");
  });

  it("clarifies two distinct works tied at top priority in ranking-tuple order", async () => {
    const alias = aliasWith(
      [{ bangumi_id: "200", priority: 40 }, { bangumi_id: "100", priority: 40 }],
      [candidate("100", 3), candidate("200", 7)],
    );

    await expect(resolveBangumi(alias, upstreamWith([]), { query: "Fate" })).resolves.toEqual({
      outcome: "needs_disambiguation",
      reason: "anime_ambiguity",
      candidates: [candidate("200", 7), candidate("100", 3)],
    });
  });

  it("resolves a strictly dominant top priority among three works", async () => {
    const alias = aliasWith(
      [
        { bangumi_id: "top", priority: 50 },
        { bangumi_id: "lower-a", priority: 40 },
        { bangumi_id: "lower-b", priority: 40 },
      ],
      [candidate("top", 0), candidate("lower-a", 10), candidate("lower-b", 20)],
    );

    await expect(resolveBangumi(alias, upstreamWith([]), { query: "Dominant" })).resolves.toEqual({
      outcome: "resolved",
      match: candidate("top", 0),
    });
  });
});

describe("resolveBangumi alias-hit dominance and orphans", () => {
  it("drops an orphaned top alias and re-ranks the surviving work", async () => {
    const alias = aliasWith(
      [{ bangumi_id: "missing", priority: 50 }, { bangumi_id: "present", priority: 40 }],
      [candidate("present", 2)],
    );

    await expect(resolveBangumi(alias, upstreamWith([]), { query: "Stale Alias" })).resolves.toEqual({
      outcome: "resolved",
      match: candidate("present", 2),
    });
  });
});

describe("resolveBangumi alias-hit candidate cap", () => {
  it("caps an over-limit tie with stable points-count-null-last ordering", async () => {
    const works = ["7", "2", "5", "1", "4", "3", "8", "6"].map((bangumi_id) => ({
      bangumi_id,
      priority: 40,
    }));
    const candidates = [
      candidate("1", 9), candidate("2", 9), candidate("3", 7), candidate("4", 5),
      candidate("8"), candidate("7"), candidate("6"), candidate("5"),
    ];

    const result = await resolveBangumi(aliasWith(works, candidates), upstreamWith([]), { query: "Series" });
    expect(result.outcome).toBe("needs_disambiguation");
    const ambiguity = result as Extract<typeof result, { outcome: "needs_disambiguation" }>;
    expect(ambiguity.candidates).toHaveLength(MAX_CANDIDATES);
    expect(ambiguity.candidates.map((item) => item.bangumi_id)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });
});

describe("resolveBangumi redacted observability", () => {
  it("records outcome, candidate count, source class, and duration without query text", async () => {
    let tick = 100;
    const observed: ResolveObservation[] = [];
    const observer: ResolveObserverPort = { record: (o) => observed.push(o) };
    const alias = aliasWith([{ bangumi_id: "3302", priority: 40 }], [candidate("3302", 2)]);

    await resolveBangumi(alias, upstreamWith([]), { query: "Lucky Star" }, {
      observer,
      clock: { now: () => tick++ },
    });

    expect(observed).toEqual([{
      outcome: "resolved",
      candidate_count: 1,
      source_class: "alias",
      duration_ms: 1,
    }]);
  });

  it("records an upstream miss observation with source class upstream", async () => {
    const observed: ResolveObservation[] = [];
    const observer: ResolveObserverPort = { record: (o) => observed.push(o) };

    await resolveBangumi(EMPTY_ALIAS, upstreamWith([]), { query: "unknown" }, { observer });

    expect(observed[0]).toMatchObject({ outcome: "not_found", candidate_count: 0, source_class: "upstream" });
  });
});
