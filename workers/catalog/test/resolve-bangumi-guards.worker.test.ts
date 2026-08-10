import { describe, expect, it } from "vitest";
import {
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
