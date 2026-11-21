import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { CatalogPrisma } from "../src/db/prisma";
import { ANITABI_EGRESS_BASE_URL } from "../src/ingest/anitabi-egress";
import { catalogIngestBangumi } from "../src/ingest/ingest-bangumi";
import { JobStore, RUNNING_TTL_SECONDS, type JobClaim } from "../src/ingest/jobs";
import type { FetchLike } from "../src/ingest/sources";
import { stubEgressSigningKey } from "./egress-stub";
import { acquired } from "./fixtures/job-claim";
import { deferred } from "./deferred";
import { databaseDescribe, openPlaneSeams, truncateCatalogPool, type PlaneSeams } from "./integration-db";

/**
 * SUT: the ingest claim's completion and failure writes (`JobStore.markDone` /
 * `markFailed`) and what `IngestBangumi` does when they find the claim gone.
 *
 * A claim that outlives RUNNING_TTL can be taken over by another invocation,
 * which restamps `started_at` and keeps the row `running`. The stalled holder
 * must then change nothing — not the winner's live claim, not a negative cache —
 * and must be told it lost, so its caller never counts the run as its own.
 */

const BANGUMI_SUBJECT = { id: 1, name: "らき☆すた", name_cn: "幸运星" };
const ANITABI_POINTS = [{ id: "lost-claim-1", name: "鷲宮神社", geo: [36.1019, 139.6586] }];
const RELAYED = { get: (name: string) => (name === "x-egress-response" ? "relayed-upstream" : null) };

let seams: PlaneSeams;
let pool: pg.Pool;
let query: CatalogPrisma;

/** The row's claim state as text, so a write that changed nothing compares equal. */
async function jobRow(workId: string): Promise<unknown> {
  const { rows } = await pool.query(
    "SELECT status, started_at::text, finished_at::text, error, error_code, stage,"
    + " negative_cached_until::text FROM ingest_jobs WHERE work_id = $1",
    [workId],
  );
  return rows[0];
}

/** Age a held claim past RUNNING_TTL, as a holder that stalled would leave it. */
async function stall(workId: string): Promise<void> {
  await pool.query(
    "UPDATE ingest_jobs SET started_at = started_at - make_interval(secs => $2) WHERE work_id = $1",
    [workId, RUNNING_TTL_SECONDS + 60],
  );
}

/** A claim, stalled, then taken over by a second acquire: the loser's and the winner's. */
async function takenOver(workId: string): Promise<{ loser: JobClaim; winner: JobClaim }> {
  const loser = await acquired(new JobStore(query), workId);
  await stall(workId);
  return { loser, winner: await acquired(new JobStore(query), workId) };
}

/** One upstream answer: the anitabi arm carries the egress service's relayed marker. */
function answer(status: number, body: unknown) {
  return { ok: status === 200, status, headers: RELAYED, json: () => Promise.resolve(body) };
}

/** An upstream that parks every call until released; `reached` settles once a call arrives. */
function parkedUpstream(points: unknown, status: number) {
  const reached = deferred();
  const gate = deferred();
  const fetchImpl: FetchLike = async (url) => {
    reached.settle();
    await gate.promise;
    return url.startsWith(ANITABI_EGRESS_BASE_URL) ? answer(status, points) : answer(200, BANGUMI_SUBJECT);
  };
  return { fetchImpl, reached: reached.promise, release: gate.settle };
}

/** Start an ingest whose upstream parks, and wait until it holds the claim. */
async function parkedIngest(workId: string, points: unknown, status = 200) {
  const upstream = parkedUpstream(points, status);
  const result = catalogIngestBangumi(query, stubEgressSigningKey()).ingest(workId, { fetchImpl: upstream.fetchImpl });
  await upstream.reached;
  return { result, release: upstream.release };
}

beforeAll(async () => {
  seams = await openPlaneSeams();
  pool = seams.pool;
  query = seams.query;
}, 120_000);

beforeEach(async () => {
  await truncateCatalogPool(pool);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await seams.dispose();
});

databaseDescribe("JobStore fenced writes after a takeover", () => {
  it("refuses the stalled holder's completion and leaves the winner's claim untouched", async () => {
    const { loser, winner } = await takenOver("lost-done");
    const before = await jobRow("lost-done");
    expect(await new JobStore(query).markDone(loser)).toBe("claim_lost");
    expect(await jobRow("lost-done")).toEqual(before);
    expect(await new JobStore(query).markDone(winner)).toBe("recorded");
  });

  it("refuses the stalled holder's failure and parks nothing", async () => {
    const { loser, winner } = await takenOver("lost-failed");
    const before = await jobRow("lost-failed");
    const failure = { errorCode: "upstream_fault", ttlSeconds: 3600, error: "late" };
    expect(await new JobStore(query).markFailed(loser, failure)).toBe("claim_lost");
    expect(await jobRow("lost-failed")).toEqual(before);
    expect(await new JobStore(query).markFailed(winner, failure)).toBe("recorded");
  });
});

databaseDescribe("IngestBangumi after its claim was taken over", () => {
  it("reports claim_lost for a completion and keeps the winner's running claim", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stalled = await parkedIngest("460300", ANITABI_POINTS);
    await stall("460300");
    const live = await parkedIngest("460300", ANITABI_POINTS);
    const before = await jobRow("460300");
    stalled.release();
    expect(await stalled.result).toEqual({ status: "claim_lost" });
    expect(await jobRow("460300")).toEqual(before);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("claim lost for work 460300"));
    live.release();
    expect(await live.result).toMatchObject({ status: "ingested" });
  });

  it("reports claim_lost for a failure instead of parking the winner's work", async () => {
    const stalled = await parkedIngest("460301", null, 404);
    await stall("460301");
    const live = await parkedIngest("460301", ANITABI_POINTS);
    const before = await jobRow("460301");
    stalled.release();
    expect(await stalled.result).toEqual({ status: "claim_lost" });
    expect(await jobRow("460301")).toEqual(before);
    live.release();
    expect(await live.result).toMatchObject({ status: "ingested" });
  });
});
