import { desc, eq, sql, type SQL } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { search, searchDb } from "../src/api/search";
import { spots, SpotNotFoundError } from "../src/api/spots";
import { statementBuilder, type CatalogDb } from "../src/db/client";
import { acquireCatalogRuntime, catalogPrisma, type CatalogPrisma, type CatalogRuntime } from "../src/db/prisma";
import { aliases, bangumi, points as pointsTable } from "../src/db/schema";
import { makePgCatalog } from "./integration-db-global/pg-catalog";
import { databaseDescribe, planeDatabaseUrl, truncateCatalogPool } from "./integration-db";
import { CONTESTED_ALIAS, EMPTY_WORK, RESOLVED_WORK, seedSearchSpots } from "./search-spots.fixtures";

/**
 * Integration for the two read surfaces #1631 moved onto the Prisma data plane:
 * the `search` alias lookup and the `spots` representative-point read. Both run
 * against a database the committed Prisma chain built, so `points.latitude` /
 * `longitude` are generated columns over `location` — the shape every real
 * environment has.
 *
 * EQUIVALENCE (AC1): the statements the pre-#1631 handlers issued are frozen
 * below as oracles and executed on the SAME database this file seeds, so "the
 * same rows in the same order" is measured rather than asserted, and a plan that
 * reads a different row set cannot agree with them. The oracles are kept as the
 * behaviour being replaced; one that tracked the new code could not measure it.
 *
 * The alias oracle also settles the ordering: both works carry
 * `CONTESTED_ALIAS`, the shadowed one at a LOWER priority and inserted FIRST, so
 * heap order hands back the wrong work and only `ORDER BY priority DESC` returns
 * `RESOLVED_WORK`.
 *
 * `search` spans both seams — its alias lookup is Prisma's (#1631), its
 * published-points read is still Drizzle's until #1629 — so this file drives the
 * pair exactly as `router.ts` wires them.
 */

let pool: pg.Pool;
let runtime: CatalogRuntime;
let prisma: CatalogPrisma;
let drizzle: CatalogDb;

/** `search` over the two seams the router hands it. */
function searchOnBothSeams(query: string) {
  return search(searchDb(prisma), { query });
}

/** The pre-#1631 alias statement, frozen. */
function drizzleFirstBangumiIdStatement(normalized: string): SQL {
  return statementBuilder()
    .select({ bangumiId: aliases.bangumiId })
    .from(aliases)
    .where(eq(aliases.aliasNormalized, normalized))
    .orderBy(desc(aliases.priority))
    .limit(1)
    .getSQL();
}

/** The pre-#1631 representative statement, frozen. */
function drizzleRepresentativeStatement(bangumiId: string): SQL {
  return statementBuilder()
    .select({
      id: pointsTable.id, name: pointsTable.name, nameCn: pointsTable.nameCn,
      bangumiId: pointsTable.bangumiId, episode: pointsTable.episode,
      timeSeconds: pointsTable.timeSeconds, image: pointsTable.image,
      latitude: pointsTable.latitude, longitude: pointsTable.longitude, city: pointsTable.city,
      origin: pointsTable.origin, originUrl: pointsTable.originUrl,
    })
    .from(pointsTable)
    .where(eq(pointsTable.bangumiId, bangumiId))
    .orderBy(sql`id ASC`)
    .limit(1)
    .getSQL();
}

/** The pre-#1631 joined points statement, frozen. */
function drizzlePointsForBangumiStatement(bangumiId: string): SQL {
  return statementBuilder()
    .select({
      id: pointsTable.id, name: pointsTable.name, nameCn: pointsTable.nameCn,
      bangumiId: pointsTable.bangumiId, episode: pointsTable.episode,
      timeSeconds: pointsTable.timeSeconds, image: pointsTable.image,
      latitude: pointsTable.latitude, longitude: pointsTable.longitude,
      city: pointsTable.city, origin: pointsTable.origin, originUrl: pointsTable.originUrl,
      title: bangumi.title, titleCn: bangumi.titleCn,
      coverUrl: bangumi.coverUrl, syncedAt: bangumi.updatedAt,
    })
    .from(pointsTable)
    .leftJoin(bangumi, eq(pointsTable.bangumiId, bangumi.id))
    .where(eq(pointsTable.bangumiId, bangumiId))
    .orderBy(sql`episode ASC`, sql`time_seconds ASC`, sql`id ASC`)
    .getSQL();
}

/** The representative row as the pre-#1631 handler read it — the oracle's own names. */
interface RepresentativeOracleRow {
  id: string;
  name: string;
  name_cn: string | null;
  bangumi_id: string;
  episode: number | null;
  time_seconds: number | null;
  image: string | null;
  latitude: number;
  longitude: number;
  city: string | null;
  origin: string | null;
  origin_url: string | null;
}

/** The columns of the frozen joined statement this file compares, in the names
 * Drizzle actually emits: a select key is TypeScript-side only, so a plain
 * column comes back under its OWN name (`points.image`, not `image_url`). */
interface JoinedOracleRow {
  id: string;
  image: string | null;
  latitude: number;
  longitude: number;
}

async function drizzleRepresentativeRows(bangumiId: string): Promise<RepresentativeOracleRow[]> {
  const result = await drizzle.execute(drizzleRepresentativeStatement(bangumiId));
  return result.rows as unknown as RepresentativeOracleRow[];
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: planeDatabaseUrl(), connectionTimeoutMillis: 10_000 });
  await truncateCatalogPool(pool);
  await seedSearchSpots(pool);
  runtime = await acquireCatalogRuntime(planeDatabaseUrl());
  prisma = catalogPrisma(runtime);
  drizzle = makePgCatalog(pool);
}, 120_000);

afterAll(async () => {
  await runtime[Symbol.asyncDispose]();
  await pool.end();
});

databaseDescribe("search alias lookup on the Prisma plane (#1631)", () => {
  it("resolves the contested alias to its highest-priority work, as the Drizzle path did", async () => {
    const result = await drizzle.execute(drizzleFirstBangumiIdStatement(CONTESTED_ALIAS));
    const oracle = (result.rows as unknown as { bangumi_id: string }[])[0];

    const { rows } = await searchOnBothSeams(CONTESTED_ALIAS);

    expect(oracle?.bangumi_id).toBe(RESOLVED_WORK.workId);
    expect(rows.map((row) => row.bangumi_id)).toEqual([
      RESOLVED_WORK.workId, RESOLVED_WORK.workId, RESOLVED_WORK.workId,
    ]);
  });

  it("returns the resolved work's published points in scene order", async () => {
    const { rows } = await searchOnBothSeams(CONTESTED_ALIAS);
    expect(rows.map((row) => row.id)).toEqual(["p-03", "p-02", "p-01"]);
  });

  it("matches the frozen joined statement row-for-row (AC1)", async () => {
    const result = await drizzle.execute(drizzlePointsForBangumiStatement(RESOLVED_WORK.workId));
    const oracle = result.rows as unknown as JoinedOracleRow[];

    const { rows } = await searchOnBothSeams(CONTESTED_ALIAS);

    expect(rows.map((row) => row.id)).toEqual(oracle.map((row) => row.id));
    expect(rows.map((row) => row.screenshot_url)).toEqual(oracle.map((row) => row.image ?? ""));
    expect(rows.map((row) => [row.latitude, row.longitude])).toEqual(
      oracle.map((row) => [row.latitude, row.longitude]),
    );
  });
});

databaseDescribe("spots representative read on the Prisma plane (#1631)", () => {
  it("returns the lowest-id point the frozen statement read (AC1)", async () => {
    const oracle = await drizzleRepresentativeRows(RESOLVED_WORK.workId);

    const { point } = await spots(prisma, { bangumi_id: RESOLVED_WORK.workId });

    expect([point.id, point.name, point.bangumi_id]).toEqual(
      oracle.map((row) => [row.id, row.name, row.bangumi_id]).flat(),
    );
    expect([point.latitude, point.longitude]).toEqual(
      oracle.map((row) => [row.latitude, row.longitude]).flat(),
    );
    expect([point.screenshot_url]).toEqual(oracle.map((row) => row.image ?? ""));
    expect([point.episode ?? null, point.time_seconds ?? null]).toEqual(
      oracle.map((row) => [row.episode, row.time_seconds]).flat(),
    );
    expect([point.city ?? null, point.origin ?? null, point.origin_url ?? null]).toEqual(
      oracle.map((row) => [row.city, row.origin, row.origin_url]).flat(),
    );
  });

  it("picks the lowest id, not the first scene", async () => {
    const { point } = await spots(prisma, { bangumi_id: RESOLVED_WORK.workId });
    expect(point.id).toBe("p-01");
  });

  it("computes distance_m from a lat/lng origin", async () => {
    const { point, distance_m } = await spots(prisma, {
      bangumi_id: RESOLVED_WORK.workId,
      origin: { lat: 35.681236, lng: 139.767125 },
    });
    // haversine on the sphere (R = 6 371 000 m), computed independently of this
    // code from Tokyo Station to the fixture's representative point.
    expect(distance_m).toBeCloseTo(47786.38485009018, 4);
    expect(point.id).toBe("p-01");
  });

  it("omits distance_m for a named-place origin", async () => {
    const { distance_m } = await spots(prisma, {
      bangumi_id: RESOLVED_WORK.workId,
      origin: "東京駅",
    });
    expect(distance_m).toBeUndefined();
  });
});

databaseDescribe("the representative read's failures (#1631)", () => {
  it("refuses a work with no points, as the Drizzle path did", async () => {
    expect(await drizzleRepresentativeRows(EMPTY_WORK.workId)).toEqual([]);
    await expect(spots(prisma, { bangumi_id: EMPTY_WORK.workId }))
      .rejects.toBeInstanceOf(SpotNotFoundError);
  });

  it("propagates a database failure instead of answering from a spent runtime", async () => {
    const spent = await acquireCatalogRuntime(planeDatabaseUrl());
    const spentPrisma = catalogPrisma(spent);
    await spent[Symbol.asyncDispose]();
    const failure = await spots(spentPrisma, { bangumi_id: RESOLVED_WORK.workId })
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
  });
});
