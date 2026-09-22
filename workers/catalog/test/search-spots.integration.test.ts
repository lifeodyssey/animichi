import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { search, searchDb } from "../src/api/search";
import { spots, SpotNotFoundError } from "../src/api/spots";
import { acquireCatalogRuntime, catalogPrisma, type CatalogPrisma, type CatalogRuntime } from "../src/db/prisma";
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
 * They are frozen as TEXT rather than as builder calls (#1633): the library that
 * rendered them has left the repository, and an oracle a live library rebuilds
 * on every run could move under a version bump with no line of this file
 * changing. Each literal is what `PgDialect().sqlToQuery(…)` emitted for the
 * pre-#1631 chain, and the rows both paths returned were compared before the
 * chain was deleted.
 *
 * The alias oracle also settles the ordering: both works carry
 * `CONTESTED_ALIAS`, the shadowed one at a LOWER priority and inserted FIRST, so
 * heap order hands back the wrong work and only `ORDER BY priority DESC` returns
 * `RESOLVED_WORK`.
 *
 * `search` reaches one seam now: #1629 moved its published-points read onto the
 * plane its alias lookup already used, so this file drives it exactly as
 * `router.ts` wires it.
 */

let pool: pg.Pool;
let runtime: CatalogRuntime;
let prisma: CatalogPrisma;

/** `search` over the two seams the router hands it. */
function searchOnBothSeams(query: string) {
  return search(searchDb(prisma), { query });
}

/**
 * The pre-#1631 alias statement, frozen as the TEXT the query builder emitted.
 * A literal rather than a rebuilding call: an oracle a live library regenerates
 * on every run can move under a version bump without this file changing, and
 * then it no longer measures the behaviour being replaced.
 */
const PRE_1631_FIRST_BANGUMI_ID_SQL = 'select "bangumi_id" from "aliases" where "aliases"."alias_normalized" = $1 order by "aliases"."priority" desc limit $2';

/** The alias oracle's bound values: the normalized alias, then the row cap. */
function pre1631FirstBangumiIdParams(normalized: string): unknown[] {
  return [normalized, 1];
}

/** The pre-#1631 representative statement, frozen as its emitted text. */
const PRE_1631_REPRESENTATIVE_SQL = 'select "id", "name", "name_cn", "bangumi_id", "episode", "time_seconds", "image", "latitude", "longitude", "city", "origin", "origin_url" from "points" where "points"."bangumi_id" = $1 order by id ASC limit $2';

/** The representative oracle's bound values: the work id, then the row cap. */
function pre1631RepresentativeParams(bangumiId: string): unknown[] {
  return [bangumiId, 1];
}

/** The pre-#1631 joined points statement, frozen as its emitted text. */
const PRE_1631_POINTS_FOR_BANGUMI_SQL = 'select "points"."id", "points"."name", "points"."name_cn", "points"."bangumi_id", "points"."episode", "points"."time_seconds", "points"."image", "points"."latitude", "points"."longitude", "points"."city", "points"."origin", "points"."origin_url", "bangumi"."title", "bangumi"."title_cn", "bangumi"."cover_url", "bangumi"."updated_at" from "points" left join "bangumi" on "points"."bangumi_id" = "bangumi"."id" where "points"."bangumi_id" = $1 order by episode ASC, time_seconds ASC, id ASC';

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
  const { rows } = await pool.query(
    PRE_1631_REPRESENTATIVE_SQL, pre1631RepresentativeParams(bangumiId),
  );
  return rows as RepresentativeOracleRow[];
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: planeDatabaseUrl(), connectionTimeoutMillis: 10_000 });
  await truncateCatalogPool(pool);
  await seedSearchSpots(pool);
  runtime = await acquireCatalogRuntime(planeDatabaseUrl());
  prisma = catalogPrisma(runtime);
}, 120_000);

afterAll(async () => {
  await runtime[Symbol.asyncDispose]();
  await pool.end();
});

databaseDescribe("search alias lookup on the Prisma plane (#1631)", () => {
  it("resolves the contested alias to its highest-priority work, as the Drizzle path did", async () => {
    const { rows: oracleRows } = await pool.query(
      PRE_1631_FIRST_BANGUMI_ID_SQL, pre1631FirstBangumiIdParams(CONTESTED_ALIAS),
    );
    const oracle = (oracleRows as { bangumi_id: string }[])[0];

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
    const { rows: oracleRows } = await pool.query(
      PRE_1631_POINTS_FOR_BANGUMI_SQL, [RESOLVED_WORK.workId],
    );
    const oracle = oracleRows as JoinedOracleRow[];

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
