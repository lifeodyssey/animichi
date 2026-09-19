import { describe, expect, it } from "vitest";
import type { CatalogDb } from "../src/db/client";
import { workPointsDb } from "../src/api/work-points";
import { countingCatalogPrisma } from "./fakes/fake-catalog-prisma";
import { unreachableCatalogDb } from "./fakes/fake-catalog-db";
import { ROW } from "./in-memory-search-db";

/** A CatalogDb that counts the statements it is handed (#1630's seam). */
function countingDb(): { db: CatalogDb; statements: () => number } {
  let statements = 0;
  const execute = () => {
    statements += 1;
    return Promise.resolve({ rows: [] });
  };
  return { db: { execute } as unknown as CatalogDb, statements: () => statements };
}

describe("workPointsDb production binding", () => {
  it("binds the published-row reader to the Prisma plane, leaving the Drizzle seam untouched", async () => {
    const counter = countingCatalogPrisma([ROW]);

    await expect(workPointsDb(counter.query, unreachableCatalogDb()).pointsForBangumi("115908"))
      .resolves.toEqual([ROW]);

    expect(counter.statements()).toBe(1);
  });

  it("binds the ingest to the Drizzle seam #1630 converts, not to the Prisma plane", async () => {
    const { db, statements } = countingDb();

    await workPointsDb(countingCatalogPrisma().query, db).ingest.ensurePending("115908");

    expect(statements()).toBe(1);
  });
});
