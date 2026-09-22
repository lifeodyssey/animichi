import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { CatalogPrisma } from "../src/db/prisma";
import { PENDING_DRAIN_CRON, TTL_REFRESH_CRON } from "../src/cron-config";
import { listDoneBangumiIds, listDrainableBangumiIds, listStaleBangumiIds } from "../src/ingest/cron-queries";
import { catalogIngestBangumi } from "../src/ingest/ingest-bangumi";
import { JobStore } from "../src/ingest/jobs";
import type { FetchLike } from "../src/ingest/sources";
import { createScheduledHandler, type CronDependencies } from "../src/scheduled/ingest-schedule";
import { ANITABI_EGRESS_BASE_URL } from "../src/ingest/anitabi-egress";
import { stubEgressSigningKey } from "./egress-stub";
import {
  databaseDescribe,
  openPlaneSeams,
  truncateCatalogPool,
  type PlaneSeams,
} from "./integration-db";

const SUBJECT = {
  id: 1,
  name: "らき☆すた",
  name_cn: "幸运星",
  summary: "高校生たちの日常コメディ。",
  images: { large: "https://lain.bgm.tv/pic/cover/l/lucky.jpg" },
  rating: { score: 8.1 },
};
const POINTS = [
  { id: "washinomiya", name: "鷲宮神社", geo: [36.1019, 139.6586], ep: 1, s: 42 },
];
const WORK_IDS = ["460200", "460201", "460202"] as const;
/** Anitabi goes through the egress service, so its arm is keyed by the egress URL (#1792). */
const FETCH_BODIES = new Map<string, unknown>(WORK_IDS.flatMap((workId): [string, unknown][] => [
  [`https://api.bgm.tv/v0/subjects/${workId}`, SUBJECT],
  [`${ANITABI_EGRESS_BASE_URL}/anitabi/points/${workId}`, POINTS],
]));
/** The relayed marker the egress service stamps; Bangumi is fetched directly and carries none. */
const RELAYED = { get: (name: string) => (name === "x-egress-response" ? "relayed-upstream" : null) };
const fetchImpl: FetchLike = (url) => Promise.resolve({
  ok: true,
  status: 200,
  headers: url.startsWith(ANITABI_EGRESS_BASE_URL) ? RELAYED : undefined,
  json: () => Promise.resolve(FETCH_BODIES.get(url)),
});

let pool: pg.Pool;
let query: CatalogPrisma;
let seams: PlaneSeams;

const dependencies: CronDependencies = {
    connectPrisma: () => Promise.resolve({ query, dispose: () => Promise.resolve() }),
  ingestBangumi: (catalogDb, id, egressSigningKey) => catalogIngestBangumi(catalogDb, egressSigningKey).ingest(id, { fetchImpl }),
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

async function jobStatus(workId: string): Promise<string | undefined> {
  const { rows } = await pool.query("SELECT status FROM ingest_jobs WHERE work_id = $1", [workId]);
  return (rows as { status: string }[])[0]?.status;
}

async function pointCount(workId: string): Promise<number> {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM points WHERE bangumi_id = $1", [workId]);
  return (rows as { n: number }[])[0]?.n ?? 0;
}

async function insertStaleRunning(workId: string): Promise<void> {
  await pool.query(
    "INSERT INTO ingest_jobs (work_id, status, started_at)"
    + " VALUES ($1, 'running', NOW() - INTERVAL '16 minutes')", [workId],
  );
}

async function runScheduled(cron: string, environment: "staging" | "production"): Promise<void> {
  await createScheduledHandler(dependencies)({ cron }, {
    DATABASE_URL: "postgresql://suite-owned/test",
    ENVIRONMENT: environment,
    INGEST_SIGNING_KEY: stubEgressSigningKey(),
  });
}

beforeAll(async () => {
  seams = await openPlaneSeams();
  pool = seams.pool;
  query = seams.query;
}, 120_000);

beforeEach(async () => {
  await truncateCatalogPool(pool);
});

afterAll(async () => {
  await seams.dispose();
});

const schedules = [
  { environment: "staging", cron: PENDING_DRAIN_CRON, workId: "460200" },
  { environment: "production", cron: TTL_REFRESH_CRON, workId: "460201" },
] as const;

databaseDescribe("scheduled pending drain on real Postgres (#1229)", () => {
  it.each(schedules)("drains a pending row to done in $environment", async ({ cron, environment, workId }) => {
    await new JobStore(query).ensurePending(workId);

    await runScheduled(cron, environment);

    expect(await jobStatus(workId)).toBe("done");
    expect(await pointCount(workId)).toBe(1);
  });

  it("reclaims stale running work and completes it", async () => {
    await insertStaleRunning("460202");

    await runScheduled(PENDING_DRAIN_CRON, "staging");

    expect(await jobStatus("460202")).toBe("done");
    expect(await pointCount("460202")).toBe(1);
  });
});
