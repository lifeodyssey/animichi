import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import { nearbyDetailsPort } from "../src/adapters/outbound/nearby-points";
import { acquireCatalogRuntime, catalogPrisma } from "../src/db/prisma";
import { catalogRequest } from "./catalog-request";
import { WASHINOMIYA_ORIGIN } from "./nearby-points.fixtures";
import { databaseDescribe, planeDatabaseUrl } from "./integration-db";

/**
 * The nearby path's Prisma runtime LIFETIME (#1628, spec §4.2): the Hono
 * `/catalog/*` boundary acquires ONE `Runtime` per request and disposes it with
 * `await using` on scope exit — never a connection cached across requests.
 *
 * The app is driven over the real OpenAPI wire, so what the counters below
 * measure is the boundary's own acquire/dispose, not a seam this test chose. The
 * endpoint's answers are `nearby-points.integration.test.ts`, and the query's
 * plan and metric `nearby-metric.integration.test.ts`.
 */

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

/** Requests this file drives: a leak outgrows the reap slack. */
const REQUESTS = 4;

let counter: pg.Client;

/** One request through the real app, over the wire the clients speak. */
async function requestNearby(lat: number, lng: number, radiusM: number): Promise<Response> {
  return catalogRequest("/catalog/nearby", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lat, lng, radius_m: radiusM }),
  }, { ENVIRONMENT: "test", DATABASE_URL: planeDatabaseUrl() });
}

/**
 * The suite's connection counters for one moment: sessions ever started on this
 * database, and backends alive right now.
 *
 * `sessions` is cumulative and flushed as a backend exits (`pgstat_report_stat`
 * is forced on disconnect), so one finished request reads as exactly one more
 * session. `live` comes from `pg_stat_activity`, the LIVE backend array, rather
 * than `pg_stat_database.numbackends` — the stats row keeps counting a backend
 * for up to a second after it exits, which would make a disposal assertion flap.
 */
async function connectionStats(): Promise<{ sessions: number; live: number }> {
  const { rows } = await counter.query<{ sessions: string; live: number }>(
    `SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS live,
            (SELECT sessions FROM pg_stat_database WHERE datname = current_database()) AS sessions`,
  );
  const [stat] = rows;
  if (stat === undefined) throw new Error("no connection counters for this database");
  return { sessions: Number(stat.sessions), live: stat.live };
}

beforeAll(async () => {
  counter = new pg.Client({ connectionString: planeDatabaseUrl() });
  await counter.connect();
});

afterAll(async () => {
  await counter.end();
});

databaseDescribe("the nearby request owns its Prisma runtime (#1628)", () => {
  it("acquires one runtime per request and gives every connection back", async () => {
    const before = await connectionStats();
    for (let request = 0; request < REQUESTS; request += 1) {
      const response = await requestNearby(WASHINOMIYA_ORIGIN.lat, WASHINOMIYA_ORIGIN.lng, 10_000);
      expect(response.status).toBe(200);
    }
    const after = await connectionStats();
    // One session per request: acquired per request, never cached.
    expect(after.sessions - before.sessions).toBe(REQUESTS);
    // ... and each given back. The slack of one is the server's own: a backend
    // leaves the live array a few milliseconds after its socket closes, so the
    // LAST request's backend may still be listed — and only that one, because
    // each request takes orders of magnitude longer than the reap. A runtime
    // that is never disposed leaves one live backend PER request, which is four
    // times this bound.
    expect(after.live).toBeLessThanOrEqual(before.live + 1);
  });

  it("closes a disposed runtime instead of pooling it", async () => {
    const runtime = await acquireCatalogRuntime(planeDatabaseUrl());
    const details = nearbyDetailsPort(catalogPrisma(runtime));
    await expect(details.detailsFor(["washinomiya"])).resolves.toBeInstanceOf(Map);
    await runtime[Symbol.asyncDispose]();
    await expect(details.detailsFor(["washinomiya"])).rejects.toThrow();
  });
});
