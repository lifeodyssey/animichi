import { describe, expect, it } from "vitest";
import { publishVersion, readPublishedVersion } from "../src/publish/versioning";
import { recordingCatalogPrisma } from "./fakes/plan-inspection";

/**
 * The blue/green pointer switch, as the worker pool can see it (story 11).
 *
 * The publish is no longer a two-statement `db.batch`: neon-http had no client
 * transaction, so the flip and the insert were submitted as one array. On the
 * Prisma plane the pair runs inside a real transaction (`db/prisma.ts`), and the
 * next version is read BETWEEN them — the builder has no expression slot in an
 * INSERT's values, which is where Drizzle computed `COALESCE(MAX(version),0)+1`.
 *
 * What this suite still owns is the ORDER the plans are issued in, because
 * reversing flip and insert would momentarily leave two current rows and violate
 * the partial unique index. The atomicity of the pair is the transaction's, and
 * is proved against real Postgres in publish.integration.test.ts.
 */

describe("atomic version publish (story 11)", () => {
  it("issues the flip, the next-version read, then the insert — in that order", async () => {
    // The version READ computes `coalesce(max(version), 0) + 1` in SQL, so the row
    // it answers with is already the next version; the insert returns that same one.
    const seam = recordingCatalogPrisma([], [{ version: 8 }], [{ version: 8 }]);

    await expect(publishVersion(seam.query, "lucky-star")).resolves.toBe(8);

    expect(seam.statements()).toBe(3);
    const [flip, next, insert] = seam.plans();
    expect(flip?.ast).toMatchObject({ kind: "update" });
    expect(next?.ast).toMatchObject({ kind: "select" });
    expect(insert?.ast).toMatchObject({ kind: "insert" });
    // The flip clears the work's current row; the insert makes the new one current.
    expect(JSON.stringify(flip?.ast)).toContain("is_current");
  });

  it("binds the work id and the version the read produced", async () => {
    // The version READ computes `coalesce(max(version), 0) + 1` in SQL, so the row
    // it answers with is already the next version; the insert returns that same one.
    const seam = recordingCatalogPrisma([], [{ version: 8 }], [{ version: 8 }]);

    await publishVersion(seam.query, "lucky-star");

    expect(seam.params()).toEqual(expect.arrayContaining(["lucky-star", 8, true]));
  });

  it("falls back to version 1 when the work has no versions yet", async () => {
    const seam = recordingCatalogPrisma([], [], [{ version: 1 }]);

    await expect(publishVersion(seam.query, "brand-new")).resolves.toBe(1);
  });

  it("extracts the published version from the INSERT ... RETURNING result", () => {
    expect(readPublishedVersion([{ version: 12 }])).toBe(12);
    expect(() => readPublishedVersion([])).toThrow(/no version/);
    expect(() => readPublishedVersion([{ version: "twelve" }])).toThrow(/invalid version/);
  });
});
