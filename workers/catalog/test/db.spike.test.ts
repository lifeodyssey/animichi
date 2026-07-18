import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { aliases, bangumi, clusterVersion, points, seriesEdges } from "../src/db/schema";
import {
  databaseDescribe,
  openServerlessDb,
  restoreNeonConfig,
  truncateCatalog,
} from "./spike-db";

/**
 * DB round-trip test for the Catalog read schema (card W1-1).
 *
 * The suite-owned Neon branch inherits the complete Atlas-applied schema from
 * `test-base`; this file truncates the catalog FK closure and seeds only the rows
 * needed to prove the typed Drizzle schema matches that live DDL.
 */

let db: CatalogDb;

beforeAll(async () => {
  db = await openServerlessDb();
  await truncateCatalog(db);

  // Washinomiya Shrine (Lucky Star). The points trigger derives `location`
  // from latitude/longitude, so we insert coordinates only.
  await db.execute(sql`
    INSERT INTO bangumi (id, title, title_cn, eps_count, rating, points_count)
    VALUES ('lucky-star', 'らき☆すた', '幸运星', 24, 8.1, 1)
  `);
  await db.execute(sql`
    INSERT INTO points (id, bangumi_id, name, latitude, longitude, episode)
    VALUES ('washinomiya', 'lucky-star', '鷲宮神社', 36.1019, 139.6586, 1)
  `);
  await db.execute(sql`
    INSERT INTO cluster_version (work_id, version, is_current)
    VALUES ('lucky-star', 1, TRUE)
  `);
  await db.execute(sql`
    INSERT INTO aliases (work_id, alias, alias_normalized, source, priority)
    VALUES ('lucky-star', 'らき☆すた', 'らきすた', 'bangumi', 10)
  `);
  await db.execute(sql`
    INSERT INTO series_edges (from_work_id, to_work_id, relation)
    VALUES ('lucky-star', 'lucky-star-ova', 'sequel')
  `);
}, 120_000);

afterAll(restoreNeonConfig);

async function assertBangumiRow(): Promise<void> {
  const rows = await db.select().from(bangumi).where(eq(bangumi.id, "lucky-star"));
  expect(rows).toHaveLength(1);
  const row = rows[0];
  expect(row?.title).toBe("らき☆すた");
  expect(row?.titleCn).toBe("幸运星");
  expect(row?.epsCount).toBe(24);
  expect(row?.pointsCount).toBe(1);
  expect(Number(row?.rating)).toBeCloseTo(8.1, 1);
}

async function assertPointRow(): Promise<void> {
  const rows = await db.select().from(points).where(eq(points.id, "washinomiya"));
  expect(rows).toHaveLength(1);
  const row = rows[0];
  expect(row?.name).toBe("鷲宮神社");
  expect(row?.bangumiId).toBe("lucky-star");
  expect(row?.latitude).toBeCloseTo(36.1019, 4);
  expect(row?.longitude).toBeCloseTo(139.6586, 4);
  expect(typeof row?.location).toBe("string");
  expect(row?.location?.length).toBeGreaterThan(0);
}

async function assertSchemaRelations(): Promise<void> {
  const versions = await db.select().from(clusterVersion).where(eq(clusterVersion.workId, "lucky-star"));
  expect(versions[0]?.version).toBe(1);
  expect(versions[0]?.isCurrent).toBe(true);
  const aliasRows = await db.select().from(aliases).where(eq(aliases.workId, "lucky-star"));
  expect(aliasRows[0]?.aliasNormalized).toBe("らきすた");
  expect(aliasRows[0]?.priority).toBe(10);
  const edges = await db.select().from(seriesEdges).where(eq(seriesEdges.fromWorkId, "lucky-star"));
  expect(edges[0]?.toWorkId).toBe("lucky-star-ova");
  expect(edges[0]?.relation).toBe("sequel");
}

async function assertPostgisRadiusRead(): Promise<void> {
  const centerLat = 36.1019;
  const centerLon = 139.6586;
  const rows = (
    await db.execute(sql`
      SELECT id
      FROM points
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(${centerLon}, ${centerLat}), 4326)::geography,
        1000
      )
    `)
  ).rows as { id: string }[];
  expect(rows.map((r) => r.id)).toEqual(["washinomiya"]);
}

databaseDescribe("Catalog Drizzle read schema round-trips against real migrations", () => {
  it("reads the bangumi row through the typed schema", assertBangumiRow);
  it("reads the point row including the trigger-synced geography location", assertPointRow);
  it("reads cluster_version / aliases / series_edges through the schema", assertSchemaRelations);
  it("supports a PostGIS radius read joining schema columns with raw sql", assertPostgisRadiusRead);
});
