import { afterAll, beforeAll, expect, it } from "vitest";
import type { IngestBangumi } from "../src/ingest/ingest-bangumi";
import { databaseDescribe } from "./integration-db";
import {
  ANITABI_POINTS,
  backdateNegativeCache,
  bangumiExists,
  closeIngestPlane,
  jobStatus,
  makeFetch,
  negativeCacheSeconds,
  notFoundFetch,
  openIngestPlane,
  throwingFetch,
} from "./ingest-bangumi-plane";

/**
 * Integration suite for the IngestBangumi use case's negative cache: an empty
 * upstream, an upstream 404 and a throwing upstream each park the work behind
 * their TTL, and a parked work re-acquires once that TTL elapses, against the
 * committed Prisma chain's schema, cloned into the suite database. The ingest
 * lifecycle is `ingest-bangumi.integration.test.ts`.
 */

let ingest: IngestBangumi;

beforeAll(async () => {
  ingest = (await openIngestPlane()).ingest;
}, 120_000);

afterAll(closeIngestPlane);

databaseDescribe("IngestBangumi negative cache: empty upstream", () => {
  it("returns 'empty', parks the empty TTL, and blocks re-ingest within it", async () => {
    const fetchImpl = makeFetch([]);
    const result = await ingest.ingest("460102", { fetchImpl });
    expect(result.status).toBe("empty");
    expect(await jobStatus("460102")).toBe("failed");
    expect(await bangumiExists("460102")).toBe(false);
    const retry = await ingest.ingest("460102", { fetchImpl });
    expect(retry.status).toBe("empty");
  });

  it("parks an upstream 404 for seven days and exposes a genuine-empty guard", async () => {
    const result = await ingest.ingest("460104", { fetchImpl: notFoundFetch });
    const ttl = await negativeCacheSeconds("460104");

    expect(result.status).toBe("empty");
    expect(ttl).toBeGreaterThan(6 * 24 * 60 * 60);
    expect(ttl).toBeLessThanOrEqual(7 * 24 * 60 * 60);
    await expect(ingest.guard("460104")).resolves.toBe("empty");
  });
});

databaseDescribe("IngestBangumi retryable upstream: fetch throws", () => {
  it("throws typed upstream-unavailable and leaves a re-acquirable job", async () => {
    await expect(ingest.ingest("460103", { fetchImpl: throwingFetch })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      defined: true,
      status: 502,
    });
    expect(await jobStatus("460103")).toBe("failed");
    // After the negative-cache TTL elapses the title re-acquires and succeeds.
    await backdateNegativeCache("460103");
    const retry = await ingest.ingest("460103", { fetchImpl: makeFetch(ANITABI_POINTS) });
    expect(retry.status).toBe("ingested");
    expect(await jobStatus("460103")).toBe("done");
  });
});
