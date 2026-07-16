import { describe, expect, it } from "vitest";
import {
  MAX_CANDIDATES,
  resolve,
  type AliasWork,
  type ResolveDb,
} from "../src/api/resolve";
import type { AnimeCandidate, ResolveOutcome } from "../src/types";

type AmbiguousOutcome = Extract<ResolveOutcome, { outcome: "needs_disambiguation" }>;

function candidate(id: string, points_count?: number): AnimeCandidate {
  return { bangumi_id: id, title: `Anime ${id}`, points_count };
}

function fakeDb(works: AliasWork[], candidates: AnimeCandidate[]): ResolveDb {
  return {
    worksForAlias: () => Promise.resolve(works),
    candidatesForWorks: (ids) => Promise.resolve(candidates.filter((item) => ids.includes(item.bangumi_id))),
  };
}

describe("resolve alias HIT deduplication and ties", () => {
  it("deduplicates duplicate alias rows for one work before deciding ambiguity", async () => {
    const db = fakeDb(
      [{ work_id: "3302", priority: 40 }, { work_id: "3302", priority: 40 }],
      [candidate("3302", 2)],
    );

    await expect(resolve(db, { query: "Lucky Star" })).resolves.toEqual({
      outcome: "resolved",
      match: candidate("3302", 2),
    });
  });

  it("resolves one work reached through multiple source alias priorities", async () => {
    const db = fakeDb(
      [{ work_id: "10380", priority: 40 }, { work_id: "10380", priority: 30 }],
      [candidate("10380", 0)],
    );

    const result = await resolve(db, { query: "K-On" });
    expect(result.outcome).toBe("resolved");
  });

  it("clarifies two distinct works tied at top priority in ranking-tuple order", async () => {
    const db = fakeDb(
      [{ work_id: "200", priority: 40 }, { work_id: "100", priority: 40 }],
      [candidate("100", 3), candidate("200", 7)],
    );

    await expect(resolve(db, { query: "Fate" })).resolves.toEqual({
      outcome: "needs_disambiguation",
      reason: "anime_ambiguity",
      candidates: [candidate("200", 7), candidate("100", 3)],
    });
  });
});

describe("resolve alias HIT priority and candidate cap", () => {
  it("resolves a strictly dominant top priority among three works", async () => {
    const db = fakeDb(
      [
        { work_id: "top", priority: 50 },
        { work_id: "lower-a", priority: 40 },
        { work_id: "lower-b", priority: 40 },
      ],
      [candidate("top", 0), candidate("lower-a", 10), candidate("lower-b", 20)],
    );

    await expect(resolve(db, { query: "Dominant" })).resolves.toEqual({
      outcome: "resolved",
      match: candidate("top", 0),
    });
  });

  it("caps an over-limit tie with stable points-count-null-last ordering", async () => {
    const works = ["7", "2", "5", "1", "4", "3", "8", "6"].map((work_id) => ({
      work_id,
      priority: 40,
    }));
    const candidates = [
      candidate("1", 9), candidate("2", 9), candidate("3", 7), candidate("4", 5),
      candidate("5", 3), candidate("6", 1), candidate("7"), candidate("8"),
    ];

    const result = await resolve(fakeDb(works, candidates), { query: "Series" });
    expect(result.outcome).toBe("needs_disambiguation");
    const ambiguity = result as AmbiguousOutcome;
    expect(ambiguity.candidates).toHaveLength(MAX_CANDIDATES);
    expect(ambiguity.candidates.map((item) => item.bangumi_id)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });
});
