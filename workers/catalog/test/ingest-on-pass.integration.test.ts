import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { CatalogPrisma } from "../src/db/prisma";
import { ingestOnPass } from "../src/scheduled/ingest-schedule";
import { deferred } from "./deferred";
import { stubEgressSigningKey } from "./egress-stub";
import { unanswered } from "./fakes/unanswered-request";
import { databaseDescribe, openPlaneSeams, truncateCatalogPool, type PlaneSeams } from "./integration-db";

/**
 * SUT: one work's ingest on a cron pass (`ingestOnPass`), the production
 * `IngestBangumi` over the global fetch, run under the pass's deadline signal.
 *
 * When that signal aborts mid-fetch, the requests in flight are aborted with
 * its reason and the run records nothing: no failure parked behind a negative
 * cache, the claim left to lapse after RUNNING_TTL like a stopped holder's.
 */

let seams: PlaneSeams;
let pool: pg.Pool;
let query: CatalogPrisma;

/**
 * The global fetch, held: each request records its signal and rejects only
 * when that signal aborts. `allReached` settles once `requests` have arrived.
 */
function heldUpstream(requests: number) {
  const signals: AbortSignal[] = [];
  const arrivals = Array.from({ length: requests }, () => deferred());
  vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => {
    const signal = init?.signal ?? AbortSignal.abort(new Error("the upstream call carried no signal"));
    arrivals[signals.push(signal) - 1]?.settle();
    return unanswered<Response>(signal);
  });
  return { signals, allReached: Promise.all(arrivals.map((arrival) => arrival.promise)) };
}

async function jobRow(workId: string): Promise<unknown> {
  const { rows } = await pool.query(
    "SELECT status, error_code, negative_cached_until FROM ingest_jobs WHERE work_id = $1", [workId],
  );
  return rows[0];
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
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await seams.dispose();
});

databaseDescribe("a cron pass's ingest when the pass's deadline passes mid-fetch", () => {
  it("aborts both requests in flight with the pass's reason and parks nothing", async () => {
    const upstream = heldUpstream(2);
    const pass = new AbortController();
    const reason = new DOMException("The operation timed out.", "TimeoutError");
    const ingest = ingestOnPass(query, "460500", { egressSigningKey: stubEgressSigningKey(), signal: pass.signal });
    await upstream.allReached;
    pass.abort(reason);
    expect(upstream.signals[0]?.reason).toBe(reason);
    expect(upstream.signals[1]?.reason).toBe(reason);
    await expect(ingest).rejects.toBe(reason);
    expect(await jobRow("460500")).toEqual({ status: "running", error_code: null, negative_cached_until: null });
  });
});
