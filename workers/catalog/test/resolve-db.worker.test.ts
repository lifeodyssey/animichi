import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { resolve, resolveDb } from "../src/api/resolve";
import type { AnimeCandidate } from "../src/types";

function sqlText(value: unknown): string {
  if (value === null || typeof value !== "object") return "";
  if ("value" in value && Array.isArray(value.value)) return value.value.join("");
  if (!("queryChunks" in value) || !Array.isArray(value.queryChunks)) return "";
  return value.queryChunks.map(sqlText).join("");
}

function catalogDb(responses: unknown[][], queries: string[]): CatalogDb {
  const execute = (query: SQL) => {
    queries.push(sqlText(query));
    return Promise.resolve({ rows: responses.shift() ?? [] });
  };
  return { execute } as unknown as CatalogDb;
}

function candidate(id: string): AnimeCandidate {
  return { bangumi_id: id, title: "Zero Point Anime", points_count: 0 };
}

describe("resolve production DB adapter", () => {
  it("groups aliases by work and derives stored candidate enrichment", async () => {
    const queries: string[] = [];
    const db = catalogDb([
      [{ work_id: "3302", priority: 40 }],
      [{
        id: "3302", title: "らき☆すた", title_cn: "幸运星",
        cover_url: "cover.jpg", air_date: "2007-04-08", points_count: "2",
      }],
    ], queries);

    await expect(resolve(resolveDb(db), { query: "Lucky Star" })).resolves.toEqual({
      outcome: "resolved",
      match: {
        bangumi_id: "3302", title: "らき☆すた", title_cn: "幸运星",
        cover_url: "cover.jpg", year: 2007, points_count: 2,
      },
    });
    expect(queries[0]).toContain("GROUP BY work_id");
    expect(queries[1]).toContain("COUNT(p.id) AS points_count");
  });

  it("resolves a stored candidate whose point count is zero", async () => {
    const resolved = await resolve({
      worksForAlias: () => Promise.resolve([{ work_id: "zero", priority: 40 }]),
      candidatesForWorks: () => Promise.resolve([candidate("zero")]),
    }, { query: "Zero" });
    expect(resolved).toEqual({ outcome: "resolved", match: candidate("zero") });
  });
});
