import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import type { CatalogPrisma } from "../src/db/prisma";
import { publishVersion } from "../src/publish/versioning";
import { getItinerarySnapshot, saveItinerarySnapshot } from "../src/publish/snapshots";
import { gcOldVersions } from "../src/publish/gc";
import {
  databaseDescribe,
  openPlaneSeams,
  restoreNeonConfig,
  truncateCatalog,
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

let db: CatalogDb;
let query: CatalogPrisma;
let seams: PlaneSeams;

async function currentVersions(workId: string): Promise<number[]> {
  const rows = (
    await db.execute(
      sql`SELECT version FROM cluster_version WHERE bangumi_id = ${workId} AND is_current ORDER BY version`,
    )
  ).rows as { version: number }[];
  return rows.map((r) => r.version);
}

async function allVersions(workId: string): Promise<number[]> {
  const rows = (
    await db.execute(
      sql`SELECT version FROM cluster_version WHERE bangumi_id = ${workId} ORDER BY version`,
    )
  ).rows as { version: number }[];
  return rows.map((r) => r.version);
}

beforeAll(async () => {
  seams = await openPlaneSeams();
  db = seams.db;
  query = seams.query;
  await truncateCatalog(db);
}, 120_000);

afterAll(async () => {
  await seams.dispose();
  restoreNeonConfig();
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
});

databaseDescribe("saveItinerarySnapshot binds an itinerary to a version so it never drifts", () => {
  it("reads back a v1 snapshot unchanged after v2 publishes (no drift)", async () => {
    await publishVersion(query, "drift");
    await saveItinerarySnapshot(db, "drift", 1, { order: ["a", "b"] });
    await publishVersion(query, "drift");
    const snap = (await getItinerarySnapshot(db, "drift", 1)) as { order: string[] };
    expect(snap.order).toEqual(["a", "b"]);
  });
});

databaseDescribe("gcOldVersions keeps the newest N and never the current", () => {
  it("removes v1 but never the current version with keep=1", async () => {
    await publishVersion(query, "gc");
    await publishVersion(query, "gc");
    const deleted = await gcOldVersions(db, "gc", 1);
    expect(deleted).toBe(1);
    expect(await allVersions("gc")).toEqual([2]);
    expect(await currentVersions("gc")).toEqual([2]);
  });
});
