import { describe, expect, it } from "vitest";
import type { CatalogDb } from "../src/db/client";
import { workPointsDb } from "../src/api/work-points";

describe("workPointsDb production binding", () => {
  it("binds the published-row reader to the catalog SQL adapter", async () => {
    let reads = 0;
    const execute = () => {
      reads += 1;
      return Promise.resolve({ rows: [] });
    };
    const db = { execute } as unknown as CatalogDb;

    await expect(workPointsDb(db).pointsForBangumi("115908")).resolves.toEqual([]);

    expect(reads).toBe(1);
  });
});
