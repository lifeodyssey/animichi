import { describe, expect, it } from "vitest";
import { workPointsDb } from "../src/api/work-points";
import { countingCatalogPrisma } from "./fakes/fake-catalog-prisma";
import { ROW } from "./in-memory-search-db";

/**
 * The `workPointsDb` production binding (#1630).
 *
 * The factory used to take TWO seams — the published-points reader on Prisma
 * and the ingest on Drizzle — because the migration was mid-flight. Both sides
 * are plans off this request's runtime now, so the binding has ONE seam, and
 * what these cases pin is exactly that: the read and the ingest both spend
 * statements on the runtime the caller handed in.
 */

describe("workPointsDb production binding", () => {
  it("binds the published-row reader to this request's runtime", async () => {
    const counter = countingCatalogPrisma([ROW]);

    await expect(workPointsDb(counter.query).pointsForBangumi("115908"))
      .resolves.toEqual([ROW]);
    expect(counter.statements()).toBe(1);
  });

  it("binds the ingest to the same runtime, not to a second construction site", async () => {
    const counter = countingCatalogPrisma();

    await workPointsDb(counter.query).ingest.ensurePending("115908");

    // The park states the guarded claim as its two statements: UPDATE the row
    // when it is claimable, else INSERT it.
    expect(counter.statements()).toBe(2);
  });
});
