import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { PENDING_DRAIN_CRON, TTL_REFRESH_CRON } from "../src/cron-config";
import { listDoneBangumiIds, listDrainableBangumiIds, listStaleBangumiIds } from "../src/ingest/cron-queries";
import { catalogIngestBangumi } from "../src/ingest/ingest-bangumi";
import { JobStore } from "../src/ingest/jobs";
import type { FetchLike } from "../src/ingest/sources";
import { createScheduledHandler, type CronDependencies } from "../src/scheduled/ingest-schedule";
import { databaseDescribe, openServerlessDb, restoreNeonConfig, truncateCatalog } from "./spike-db";

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
const FETCH_BODIES = new Map<string, unknown>(WORK_IDS.flatMap((workId): [string, unknown][] => [
  [`https://api.bgm.tv/v0/subjects/${workId}`, SUBJECT],
  [`https://api.anitabi.cn/bangumi/${workId}/points/detail?haveImage=true`, POINTS],
]));
const fetchImpl: FetchLike = (url) => Promise.resolve({
  ok: true,
  status: 200,
  json: () => Promise.resolve(FETCH_BODIES.get(url)),
});

let db: CatalogDb;

const dependencies: CronDependencies = {
  connect: () => Promise.resolve(db),
  ingestBangumi: (catalogDb, id) => catalogIngestBangumi(catalogDb).ingest(id, { fetchImpl }),
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
  const result = await db.execute(sql`SELECT status FROM ingest_jobs WHERE work_id = ${workId}`);
  const rows = result.rows as { status: string }[];
  return rows[0]?.status;
}

async function pointCount(workId: string): Promise<number> {
  const result = await db.execute(sql`SELECT COUNT(*)::int AS n FROM points WHERE bangumi_id = ${workId}`);
  const rows = result.rows as { n: number }[];
  return rows[0]?.n ?? 0;
}

async function insertStaleRunning(workId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO ingest_jobs (work_id, status, started_at)
    VALUES (${workId}, 'running', NOW() - INTERVAL '16 minutes')
  `);
}

async function runScheduled(cron: string, environment: "staging" | "production"): Promise<void> {
  await createScheduledHandler(dependencies)({ cron }, {
    DATABASE_URL: "postgresql://suite-owned/test",
    ENVIRONMENT: environment,
  });
}

beforeAll(async () => {
  db = await openServerlessDb();
}, 120_000);

beforeEach(async () => {
  await truncateCatalog(db);
});

afterAll(() => { restoreNeonConfig(); });

const schedules = [
  { environment: "staging", cron: PENDING_DRAIN_CRON, workId: "460200" },
  { environment: "production", cron: TTL_REFRESH_CRON, workId: "460201" },
] as const;

databaseDescribe("scheduled pending drain on real Postgres (#1229)", () => {
  it.each(schedules)("drains a pending row to done in $environment", async ({ cron, environment, workId }) => {
    await new JobStore(db).ensurePending(workId);

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
