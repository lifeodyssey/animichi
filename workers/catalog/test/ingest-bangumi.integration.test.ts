import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { IngestBangumi } from "../src/ingest/ingest-bangumi";
import { databaseDescribe } from "./integration-db";
import {
  ANITABI_POINTS,
  awaitRunning,
  bangumiExists,
  closeIngestPlane,
  currentVersion,
  jobStatus,
  makeFetch,
  makeGatedFetch,
  openIngestPlane,
  pointCount,
} from "./ingest-bangumi-plane";

/**
 * Integration suite for the IngestBangumi use case's lifecycle: acquire -> fetch ->
 * raw -> enrich -> publish -> completion over the source/store/publisher ports, with
 * singleflight, crash recovery, and idempotent replay (mirrors the worker-pool
 * component tests against the committed Prisma chain's schema, cloned into the
 * suite database). The negative-cache arms are
 * `ingest-bangumi-negative-cache.integration.test.ts`.
 */

let pool: pg.Pool;
let ingest: IngestBangumi;

beforeAll(async () => {
  const plane = await openIngestPlane();
  pool = plane.pool;
  ingest = plane.ingest;
}, 120_000);

afterAll(closeIngestPlane);

databaseDescribe("IngestBangumi end-to-end: claim -> fetch -> raw -> enrich -> publish -> done", () => {
  it("ingests a new title and lands it in the catalog with one current version", async () => {
    const result = await ingest.ingest("460100", { fetchImpl: makeFetch(ANITABI_POINTS) });
    expect(result).toEqual({ status: "ingested", version: 1, pointCount: 2 });
    expect(await bangumiExists("460100")).toBe(true);
    expect(await pointCount("460100")).toBe(2);
    expect(await currentVersion("460100")).toBe(1);
    expect(await jobStatus("460100")).toBe("done");
  });
});

databaseDescribe("IngestBangumi claim uniqueness: concurrent double ingest", () => {
  it("yields exactly one 'ingested' and one 'in_progress'", async () => {
    let release: () => void = () => { /* placeholder replaced by Promise constructor */ };
    const gate = new Promise<void>((r) => (release = r));
    // Winner parks in fetch (job 'running'); loser's claim then loses the race.
    const winner = ingest.ingest("460101", { fetchImpl: makeGatedFetch(gate) });
    await awaitRunning("460101");
    const loserFetch = vi.fn(makeFetch(ANITABI_POINTS));
    const loser = await ingest.ingest("460101", { fetchImpl: loserFetch });
    release();
    const a = await winner;
    const statuses = [a.status, loser.status].sort();
    expect(statuses).toEqual(["in_progress", "ingested"]);
    expect(loserFetch).not.toHaveBeenCalled();
    expect(await currentVersion("460101")).toBe(1);
  });
});

databaseDescribe("IngestBangumi crash recovery + idempotent replay", () => {
  it("reclaims a stale running claim (crashed peer) and completes it", async () => {
    await pool.query(
      "INSERT INTO ingest_jobs (work_id, status, started_at)"
      + " VALUES ('460105', 'running', NOW() - INTERVAL '16 minutes')",
    );
    const result = await ingest.ingest("460105", { fetchImpl: makeFetch(ANITABI_POINTS) });
    expect(result.status).toBe("ingested");
    expect(await jobStatus("460105")).toBe("done");
  });

  it("re-ingests idempotently: re-enrich upserts, no duplicate points, version bumps once", async () => {
    const first = await ingest.ingest("460106", { fetchImpl: makeFetch(ANITABI_POINTS) });
    const second = await ingest.ingest("460106", { fetchImpl: makeFetch(ANITABI_POINTS) });

    expect([first.status, second.status]).toEqual(["ingested", "ingested"]);
    expect(await pointCount("460106")).toBe(2);
    expect(await currentVersion("460106")).toBe(2);
    expect(await jobStatus("460106")).toBe("done");
  });
});
