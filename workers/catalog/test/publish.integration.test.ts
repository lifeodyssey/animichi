import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { CatalogPrisma } from "../src/db/prisma";
import { publishVersion } from "../src/publish/versioning";
import { getItinerarySnapshot, saveItinerarySnapshot } from "../src/publish/snapshots";
import { gcOldVersions } from "../src/publish/gc";
import {
  databaseDescribe,
  openPlaneSeams,
  truncateCatalogPool,
  type PlaneSeams,
} from "./integration-db";

/**
 * Integration suite for the Publish stage (card W3-1): atomic version switch over
 * `cluster_version`, no-drift itinerary snapshots over `itinerary_snapshots`, and
 * version GC.
 *
 * Uses the complete Atlas schema inherited by the suite branch, including the
 * partial unique index that forces the flip-then-insert publish order.
 */

let pool: pg.Pool;
let query: CatalogPrisma;
let seams: PlaneSeams;

async function currentVersions(workId: string): Promise<number[]> {
  const rows = (
    await pool.query(
      "SELECT version FROM cluster_version WHERE bangumi_id = $1 AND is_current ORDER BY version", [workId],
    )
  ).rows as { version: number }[];
  return rows.map((r) => r.version);
}

async function allVersions(workId: string): Promise<number[]> {
  const rows = (
    await pool.query(
      "SELECT version FROM cluster_version WHERE bangumi_id = $1 ORDER BY version", [workId],
    )
  ).rows as { version: number }[];
  return rows.map((r) => r.version);
}

beforeAll(async () => {
  seams = await openPlaneSeams();
  pool = seams.pool;
  query = seams.query;
  await truncateCatalogPool(pool);
}, 120_000);

afterAll(async () => {
  await seams.dispose();
});

databaseDescribe("publishVersion atomic version switch over cluster_version", () => {
  it("publishes v1 as the single current version", async () => {
    const v = await publishVersion(query, "switch");
    expect(v).toBe(1);
    expect(await currentVersions("switch")).toEqual([1]);
  });

  it("publishes v2: exactly one current row, it is v2, v1 retained non-current", async () => {
    const v = await publishVersion(query, "switch");
    expect(v).toBe(2);
    expect(await currentVersions("switch")).toEqual([2]);
    expect(await allVersions("switch")).toEqual([1, 2]);
  });

  it("never creates two currents under a concurrent double-publish", async () => {
    await Promise.allSettled([
      publishVersion(query, "race"),
      publishVersion(query, "race"),
    ]);
    expect(await currentVersions("race")).toHaveLength(1);
  });

  it("discards the flip when the publish fails after it (never zero currents)", async () => {
    // The version read computes coalesce(max(version), 0) + 1, so a work already
    // at int4's ceiling makes the SECOND statement of the publish fail — after
    // the flip, before the insert. Inside one transaction the flip is discarded;
    // without one the work would be left with no current row at all.
    await pool.query(
      "INSERT INTO cluster_version (bangumi_id, version, is_current) VALUES ('overflow', 2147483647, true)",
    );
    await expect(publishVersion(query, "overflow")).rejects.toThrow();
    expect(await currentVersions("overflow")).toEqual([2147483647]);
  });
});

databaseDescribe("saveItinerarySnapshot binds an itinerary to a version so it never drifts", () => {
  it("reads back a v1 snapshot unchanged after v2 publishes (no drift)", async () => {
    await publishVersion(query, "drift");
    await saveItinerarySnapshot(query, "drift", 1, { order: ["a", "b"] });
    await publishVersion(query, "drift");
    const snap = (await getItinerarySnapshot(query, "drift", 1)) as { order: string[] };
    expect(snap.order).toEqual(["a", "b"]);
  });
});

databaseDescribe("gcOldVersions keeps the newest N and never the current", () => {
  it("removes v1 but never the current version with keep=1", async () => {
    await publishVersion(query, "gc");
    await publishVersion(query, "gc");
    const deleted = await gcOldVersions(query, "gc", 1);
    expect(deleted).toBe(1);
    expect(await allVersions("gc")).toEqual([2]);
    expect(await currentVersions("gc")).toEqual([2]);
  });
});
