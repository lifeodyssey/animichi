import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import { databaseDescribe, directPoolConfig, planeDatabaseUrl, truncateCatalogPool } from "./integration-db";
import { getPublic } from "./catalog-integration-client";

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
 * SUT: the catalog Worker's `GET /catalog/public/popular` with the `limit` its callers send, through
 * the whole app and the ranking query on the suite database (the Docker arm, schema from the
 * committed Prisma chain).
 *
 * Ten works are ranked, more than the web's limit of 8, so "no more than the limit" is a cap the
 * database applies rather than a property of a small fixture. `?limit=3` is not the contract's
 * default: a handler that dropped the parameter would answer the default 8 and still pass a test
 * that sent only the web's `?limit=8`, so exactly three rows is what proves the limit is read.
 */

/** Ten works with points, best-rated first: ratings 10 down to 1, so the order has no ties. */
const RANKED = Array.from({ length: 10 }, (_, rank) => ({ id: String(4001 + rank), rating: 10 - rank }));
const RANKED_IDS = RANKED.map((work) => work.id);

let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool(directPoolConfig(planeDatabaseUrl()));
  await truncateCatalogPool(pool);
  await pool.query(
    "INSERT INTO bangumi (id, title, points_count, rating)"
    + " SELECT id, 'Ranked ' || id, 1, rating FROM unnest($1::text[], $2::real[]) AS ranked(id, rating)",
    [RANKED_IDS, RANKED.map((work) => work.rating)],
  );
}, 120_000);

afterAll(async () => {
  await pool.end();
});

/** The work ids the public ranking answers for `query`, in the order it answered them. */
async function rankedIds(query: string): Promise<string[]> {
  const body = await (await getPublic(`popular${query}`)).json<{ bangumi: { bangumi_id: string }[] }>();
  return body.bangumi.map((work) => work.bangumi_id);
}

databaseDescribe("GET /catalog/public/popular caps the ranking at the limit it is sent", () => {
  it("answers ?limit=3 with exactly the three best-rated works", async () => {
    expect(await rankedIds("?limit=3")).toEqual(RANKED_IDS.slice(0, 3));
  });

  it("answers ?limit=8, the web's request, with exactly eight of the ten", async () => {
    expect(await rankedIds("?limit=8")).toEqual(RANKED_IDS.slice(0, 8));
  });
});
