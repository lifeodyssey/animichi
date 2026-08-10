import { describe, expect, it } from "vitest";
import {
  MAX_CANDIDATES,
  resolveBangumi,
  type AliasWork,
  type TitleAliasPort,
  type UpstreamTitlePort,
} from "../src/application/resolve-bangumi";
import type { AnimeCandidate } from "../src/types";

type Subject = Record<string, unknown> & { id: string };

function aliasWith(works: AliasWork[], candidates: AnimeCandidate[]): TitleAliasPort {
  return {
    worksForAlias: () => Promise.resolve(works),
    candidatesForWorks: (ids) => Promise.resolve(candidates.filter((item) => ids.includes(item.bangumi_id))),
  };
}

function subject(id: number, name: string, name_cn?: string): Subject {
  return { id: String(id), name, name_cn };
}

function upstreamWith(subjects: Subject[]): UpstreamTitlePort {
  return { fetchSubjects: () => Promise.resolve(subjects) };
}

function candidate(id: string, points_count?: number): AnimeCandidate {
  return { bangumi_id: id, title: `Anime ${id}`, points_count };
}

const EMPTY_ALIAS = aliasWith([], []);

describe("resolveBangumi guard paths", () => {
  it("resolves the relevance head when the query normalizes to empty", async () => {
    const subjects = [{ id: "10", name: "Relevance Head" }];

    await expect(resolveBangumi(EMPTY_ALIAS, upstreamWith(subjects), { query: "   " })).resolves.toEqual({
      outcome: "resolved",
      match: { bangumi_id: "10", title: "Relevance Head" },
    });
  });

  it("drops the year when air_date does not parse to a year", async () => {
    const subjects = [{ id: "40", name: "No Year Anime", air_date: "unknown" }];

    await expect(resolveBangumi(EMPTY_ALIAS, upstreamWith(subjects), { query: "no year" })).resolves.toEqual({
      outcome: "resolved",
      match: { bangumi_id: "40", title: "No Year Anime" },
    });
  });

  it("orders duplicated candidate rows stably within an ambiguity", async () => {
    const works: AliasWork[] = [
      { bangumi_id: "100", priority: 40 },
      { bangumi_id: "200", priority: 40 },
    ];
    const candidates = [candidate("100", 3), candidate("100", 3), candidate("200", 7)];

    const result = await resolveBangumi(aliasWith(works, candidates), upstreamWith([]), { query: "Fate" });
    expect(result.outcome).toBe("needs_disambiguation");
    const ambiguity = result as Extract<typeof result, { outcome: "needs_disambiguation" }>;
    expect(ambiguity.candidates.map((item) => item.bangumi_id)).toEqual(["200", "100", "100"]);
  });
});

describe("catalog resolve observation guards", () => {
  it("ambiguity outcome records candidate_count and source_class", async () => {
    const records: { count: number; source: string }[] = [];
    const outcome = await resolveBangumi(
      EMPTY_ALIAS,
      upstreamWith([subject(1, "涼宮ハルヒの憂鬱", "凉宫春日的忧郁"), subject(2, "凉宫ハルヒの消失", "凉宫春日的消失")]),
      { query: "凉宫" },
      { observer: { record: (o) => records.push({ count: o.candidate_count, source: o.source_class }) } },
    );
    expect(outcome.outcome).toBe("needs_disambiguation");
    expect(records[0]).toEqual({ count: 2, source: "upstream" });
  });

  it("duration clamps to zero when the clock goes backwards", async () => {
    let now = 100;
    const records: number[] = [];
    await resolveBangumi(EMPTY_ALIAS, upstreamWith([]), { query: "zzz-nonexistent" }, {
      clock: { now: () => now },
      observer: { record: (o) => records.push(o.duration_ms) },
    });
    now = 50;
    await resolveBangumi(EMPTY_ALIAS, upstreamWith([]), { query: "zzz-nonexistent" }, {
      clock: { now: () => now },
      observer: { record: (o) => records.push(o.duration_ms) },
    });
    expect(records[records.length - 1]).toBe(0);
  });

  it("upstream ambiguity respects MAX_CANDIDATES", async () => {
    const many = Array.from({ length: MAX_CANDIDATES + 5 }, (_, i) => subject(i, `凉宫${String(i)}`));
    const outcome = await resolveBangumi(EMPTY_ALIAS, upstreamWith(many), { query: "凉宫" });
    expect(outcome.outcome).toBe("needs_disambiguation");
    if (outcome.outcome === "needs_disambiguation") {
      expect(outcome.candidates.length).toBeLessThanOrEqual(MAX_CANDIDATES);
    }
  });
});
