/**
 * The refusal alarm over the real drain and real Postgres (#1784): a source
 * refusing every request raises one alarm, however many jobs it refuses. The
 * upstream is a fetch double answering Anitabi with a 403.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { PENDING_DRAIN_BATCH_CAP, PENDING_DRAIN_CRON } from "../src/cron-config";
import { listDoneBangumiIds, listDrainableBangumiIds, listStaleBangumiIds } from "../src/ingest/cron-queries";
import { catalogIngestBangumi } from "../src/ingest/ingest-bangumi";
import { JobStore } from "../src/ingest/jobs";
import type { UpstreamRefusal } from "../src/ingest/refusal-alarm";
import type { FetchLike } from "../src/ingest/sources";
import { createScheduledHandler, type CronDependencies } from "../src/scheduled/ingest-schedule";
import { ANITABI_EGRESS_BASE_URL } from "../src/ingest/anitabi-egress";
import { stubEgressSigningKey } from "./egress-stub";
import { databaseDescribe, openServerlessDb, restoreNeonConfig, truncateCatalog } from "./integration-db";

/**
 * The anitabi arm here is the egress service relaying the upstream's own 403
 * (#1792): the answer comes back marked `relayed-upstream`, which is what keeps
 * it an UPSTREAM refusal — the alarm, the 24h park and the "talk to them"
 * guidance all belong to that world, not to our own service's refusals.
 */
const REFUSING_HOST = ANITABI_EGRESS_BASE_URL;

/** The relayed marker; a refusal of ours would instead carry `refused-here`. */
const RELAYED = { get: (name: string) => (name === "x-egress-response" ? "relayed-upstream" : null) };

let db: CatalogDb;
let raised: UpstreamRefusal[] = [];
let refusedRequests = 0;

/** Bangumi answers; Anitabi answers every request with a bot-protection 403. */
const fetchImpl: FetchLike = (url) => {
  const refused = url.startsWith(REFUSING_HOST);
  if (refused) refusedRequests += 1;
  return Promise.resolve({
    ok: !refused,
    status: refused ? 403 : 200,
    headers: refused ? RELAYED : undefined,
    json: () => Promise.resolve({ id: 276, name: "響け！ユーフォニアム" }),
  });
};

const alarm = { upstreamRefused: (refusal: UpstreamRefusal) => { raised.push(refusal); } };

const dependencies: CronDependencies = {
  connect: () => Promise.resolve(db),
  ingestBangumi: (catalogDb, id, egressSigningKey) =>
    catalogIngestBangumi(catalogDb, egressSigningKey, alarm).ingest(id, { fetchImpl }),
  listDoneBangumiIds,
  listDrainableBangumiIds,
  listStaleBangumiIds,
  runDailyIngest: () => Promise.resolve({ status: "complete", runId: "unused", createdAt: "unused" }),
  snapshotStore: () => null,
  publishRun: () => Promise.resolve({ status: "invalid", reason: "unused" }),
  gcSnapshots: () => Promise.resolve({ deleted: 0, retained: [] }),
  importSource: () => null,
  runImport: () => Promise.resolve({ status: "invalid", reason: "unused" }),
};

async function parkWorks(count: number): Promise<void> {
  const store = new JobStore(db);
  for (let n = 0; n < count; n++) await store.ensurePending(String(470000 + n));
}

/** Run the staging drain pass after pass, as the hourly cron would, until nothing is drainable. */
async function drainEverything(count: number): Promise<void> {
  const passes = Math.ceil(count / PENDING_DRAIN_BATCH_CAP);
  const drain = createScheduledHandler(dependencies);
  for (let pass = 0; pass < passes; pass++) {
    await drain({ cron: PENDING_DRAIN_CRON }, {
      DATABASE_URL: "postgresql://suite-owned/test",
      ENVIRONMENT: "staging",
      INGEST_SIGNING_KEY: stubEgressSigningKey(),
    });
  }
}

async function refusedRows(): Promise<{ stage: string; error: string; parked_hours: number }[]> {
  const result = await db.execute(sql`
    SELECT stage, error, ROUND(EXTRACT(EPOCH FROM negative_cached_until - finished_at) / 3600)::int AS parked_hours
    FROM ingest_jobs WHERE status = 'failed' AND error_code = 'upstream_refused'
  `);
  return result.rows as { stage: string; error: string; parked_hours: number }[];
}

beforeAll(async () => { db = await openServerlessDb(); }, 120_000);

beforeEach(async () => {
  await truncateCatalog(db);
  raised = [];
  refusedRequests = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => { vi.restoreAllMocks(); });

afterAll(() => { restoreNeonConfig(); });

databaseDescribe("the refusal alarm on real Postgres (#1784)", () => {
  it("raises exactly one alarm for one refused job and parks the row as a refusal", async () => {
    await parkWorks(1);

    await drainEverything(1);

    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ upstream: "anitabi", workId: "470000" });
    const [row] = await refusedRows();
    expect(row).toMatchObject({ stage: "fetch:anitabi", parked_hours: 24 });
    expect(row?.error).toContain("retrying will not help");
  });

  it("raises one alarm, not a hundred, when a hundred jobs are refused the same way", async () => {
    await parkWorks(100);

    await drainEverything(100);

    expect(await refusedRows()).toHaveLength(100);
    expect(refusedRequests).toBe(100);
    expect(raised).toHaveLength(1);
  });
});
