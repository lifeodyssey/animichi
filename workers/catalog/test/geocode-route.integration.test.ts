import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import type { GeocodeResult } from "../src/types";
import { databaseDescribe, directPoolConfig, planeDatabaseUrl } from "./integration-db";
import { call } from "./catalog-integration-client";
import { BEST_RANKED_IDS, SAME_NAME_PLACES, SHARED_NAME, type SameNamePlace } from "./fixtures/same-name-places";

// The Node integration pool has no workerd runtime; stub the runtime module so
// `src/index.ts` (which exports the `IngestEntrypoint` named entrypoint) loads in plain Node.
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
 * SUT: the catalog Worker's `POST /catalog/geocode` with the request its one caller sends, the
 * agent's nearby search asking for `{ query, limit: 5 }` (`packages/agent/src/search-nearby.ts`),
 * through the whole app and the gazetteer's exact read on the suite database (the Docker arm,
 * schema from the committed Prisma chain).
 *
 * Six places answer to 府中, one more than the agent's limit, so five is a cap the route applies.
 * One more place answers only to 西宮, and its alias row carries the highest priority of all, so a
 * read that lost its alias filter would rank it first. `call` asserts the 200 before any body is
 * read. The same request with the connection replaced is `geocode-route.worker.test.ts`.
 */
const UNRELATED: SameNamePlace = {
  id: "seed:nishinomiya-station", name: "西宮駅", kind: "station", latitude: 34.7386, longitude: 135.3485,
  source: "manual", pref: "兵庫県", priority: 100,
};

let pool: pg.Pool;

/** One place and the one alias row it answers to, written as the gazetteer tables hold them. */
async function seedPlace(place: SameNamePlace, alias: string): Promise<void> {
  await pool.query(
    "INSERT INTO locations (id, name, kind, latitude, longitude, source, pref) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [place.id, place.name, place.kind, place.latitude, place.longitude, place.source, place.pref],
  );
  await pool.query(
    "INSERT INTO location_aliases (alias, alias_normalized, location_id, lang, priority) VALUES ($1, $2, $3, $4, $5)",
    [alias, alias, place.id, "ja", place.priority],
  );
}

beforeAll(async () => {
  pool = new pg.Pool(directPoolConfig(planeDatabaseUrl()));
  // `truncateCatalogPool` leaves the gazetteer alone, and another file seeds it, so this one clears it.
  await pool.query("TRUNCATE location_aliases, locations RESTART IDENTITY CASCADE");
  for (const place of SAME_NAME_PLACES) await seedPlace(place, SHARED_NAME);
  await seedPlace(UNRELATED, "西宮");
}, 120_000);

afterAll(async () => {
  await pool.end();
});

/** The ids of the places the route answers for 府中 at `limit`, in the order it answered them. */
async function candidateIds(limit: number): Promise<string[]> {
  const body = await call<GeocodeResult>("geocode", { query: SHARED_NAME, limit });
  return body.candidates.map((candidate) => candidate.id);
}

databaseDescribe("POST /catalog/geocode answers the agent's request from the gazetteer on the database", () => {
  it("answers { query, limit: 5 } with exactly the five best-ranked of the six places named 府中", async () => {
    expect(await candidateIds(5)).toEqual(BEST_RANKED_IDS.slice(0, 5));
  });

  it("answers limit 2, not the default of 5, with exactly the two best-ranked", async () => {
    expect(await candidateIds(2)).toEqual(BEST_RANKED_IDS.slice(0, 2));
  });
});
