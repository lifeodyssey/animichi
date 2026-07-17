import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { workPointsDb } from "../src/api/work-points";

function sqlText(value: unknown): string {
  if (value === null || typeof value !== "object") return "";
  if ("value" in value && Array.isArray(value.value)) return value.value.join("");
  if (!("queryChunks" in value) || !Array.isArray(value.queryChunks)) return "";
  return value.queryChunks.map(sqlText).join("");
}

describe("workPointsDb production binding", () => {
  it("binds the published-row reader to the catalog SQL adapter", async () => {
    const queries: string[] = [];
    const execute = (query: SQL) => {
      queries.push(sqlText(query));
      return Promise.resolve({ rows: [] });
    };
    const db = { execute } as unknown as CatalogDb;

    await expect(workPointsDb(db).pointsForWork("115908")).resolves.toEqual([]);

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("FROM points p LEFT JOIN bangumi b");
  });
});
