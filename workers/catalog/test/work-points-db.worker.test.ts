import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { CatalogDb } from "../src/db/client";
import { workPointsDb } from "../src/api/work-points";

function sqlText(value: unknown): string {
  return new PgDialect().sqlToQuery(value as SQL).sql;
}

describe("workPointsDb production binding", () => {
  it("binds the published-row reader to the catalog SQL adapter with scene order", async () => {
    const queries: string[] = [];
    const execute = (query: SQL) => {
      queries.push(sqlText(query));
      return Promise.resolve({ rows: [] });
    };
    const db = { execute } as unknown as CatalogDb;

    await expect(workPointsDb(db).pointsForBangumi("115908")).resolves.toEqual([]);

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("from \"points\" left join \"bangumi\"");
    expect(queries[0]).toContain("where \"points\".\"bangumi_id\" = $1");
    expect(queries[0]).toContain("order by \"points\".\"episode\" asc, \"points\".\"time_seconds\" asc, \"points\".\"id\" asc");
  });
});
