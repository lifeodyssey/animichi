import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { call } from "./catalog-integration-client";
import { databaseDescribe, directPoolConfig, planeDatabaseUrl, truncateCatalogPool } from "./integration-db";
import { WIRE_ALIAS, WIRE_POINT, WIRE_WORK, seedWirePoint } from "./point-wire-shape.fixtures";

// The Node integration pool has no workerd runtime; stub the runtime module so
// `src/index.ts` (which exports the `IngestEntrypoint` named entrypoint) loads.
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class WorkerEntrypoint {
    readonly ctx: unknown;
    readonly env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

/**
 * The `Point` each read endpoint puts on the wire for one `points` row: search,
 * points-by-bangumi-id, spots, nearby and itinerary, through the real Hono app
 * on the Prisma-plane database (`point-wire-shape.fixtures.ts` seeds it).
 *
 * The row has every column set and its work has every title column set, so each
 * answer is compared field by field against the whole object: a field that one
 * endpoint drops, renames or fills differently turns that endpoint's case red.
 * The reads that join the work (search, points-by-bangumi-id, itinerary) add its
 * title, title_cn and cover_url. Spots and nearby select the point alone, and
 * nearby adds distance_m, which is 0 because the request is made at the point.
 */

/** What every endpoint maps from the `points` row. */
const ROW_POINT = {
  id: "wire-1",
  name: "県立北高校",
  name_cn: "县立北高中",
  bangumi_id: "3704",
  episode: 1,
  time_seconds: 95,
  screenshot_url: "https://photos.invalid/3704/wire-1.jpg",
  latitude: 34.7569,
  longitude: 135.3466,
  city: "西宮市",
  origin: "Anitabi",
  origin_url: "https://origin.invalid/points/wire-1",
};

/** The row's fields plus the work's title columns, as the joined reads answer. */
const JOINED_POINT = {
  ...ROW_POINT,
  title: "涼宮ハルヒの憂鬱",
  title_cn: "凉宫春日的忧郁",
  cover_url: "https://covers.invalid/3704.jpg",
};

/** A search-shaped answer: `partial` is set only on a preview, never on published rows. */
interface RowsBody {
  rows: unknown[];
  partial?: boolean;
}

/** The part of an itinerary answer that comes from the mapped points. */
interface ItineraryBody {
  ordered_points: unknown[];
  anime_title?: string;
  anime_title_cn?: string;
  cover_url?: string;
}

let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool(directPoolConfig(planeDatabaseUrl()));
  await truncateCatalogPool(pool);
  await seedWirePoint(pool);
}, 120_000);

afterAll(async () => {
  await pool.end();
});

databaseDescribe("the Point each read endpoint answers for one fully populated row", () => {
  it("search answers the joined point for the work's alias", async () => {
    const body = await call<RowsBody>("search", { query: WIRE_ALIAS });
    expect(body.rows).toEqual([JOINED_POINT]);
    expect(body.partial).toBeUndefined();
  });

  it("points-by-bangumi-id answers the joined point for the work's id", async () => {
    const body = await call<RowsBody>("points-by-bangumi-id", { bangumi_id: WIRE_WORK.workId });
    expect(body.rows).toEqual([JOINED_POINT]);
    expect(body.partial).toBeUndefined();
  });

  it("spots answers the row's point, without the work's titles", async () => {
    expect(await call("spots", { bangumi_id: WIRE_WORK.workId })).toEqual({ point: ROW_POINT });
  });

  it("nearby answers the row's point with its distance, without the work's titles", async () => {
    const request = { lat: WIRE_POINT.latitude, lng: WIRE_POINT.longitude, radius_m: 100 };
    expect(await call("nearby", request)).toEqual({ rows: [{ ...ROW_POINT, distance_m: 0 }] });
  });

  it("itinerary answers the joined point and takes the anime metadata from it", async () => {
    const body = await call<ItineraryBody>("itinerary", { point_ids: [WIRE_POINT.id] });
    expect(body.ordered_points).toEqual([JOINED_POINT]);
    expect([body.anime_title, body.anime_title_cn, body.cover_url])
      .toEqual([JOINED_POINT.title, JOINED_POINT.title_cn, JOINED_POINT.cover_url]);
  });
});
