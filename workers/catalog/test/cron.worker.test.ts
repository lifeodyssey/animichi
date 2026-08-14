import { beforeEach, describe, expect, it, vi } from "vitest";
import { DAILY_DISCOVER_CRON, SEED_CRON, TTL_BATCH_CAP, TTL_REFRESH_CRON } from "../src/cron-config";
import {
  bangumiSeasonResolver,
  createScheduledHandler,
  runSeedJob,
  runTtlJob,
  type CronDependencies,
  type CronJobResult,
} from "../src/index";
import { mockFetch } from "./mock-fetch-sequence";
import type { IngestResult } from "../src/ingest/ingest-bangumi";
import type { CatalogDb } from "../src/db/client";
import { SEED_BANGUMI_IDS } from "../src/ingest/seed-works";

const ENV = { DATABASE_URL: "postgresql://user:password@catalog.example/animichi" };
const INGESTED: IngestResult = { status: "ingested", version: 1, pointCount: 4 };
const IN_PROGRESS: IngestResult = { status: "in_progress" };
const db = {} as unknown as CatalogDb;

function result(attempted: number, ingested: number): CronJobResult {
  return { attempted, ingested, skipped: attempted - ingested };
}

function dependencies(overrides: Partial<CronDependencies> = {}): CronDependencies {
  return {
    connect: vi.fn<CronDependencies["connect"]>().mockResolvedValue(db),
    ingestBangumi: vi.fn<CronDependencies["ingestBangumi"]>().mockResolvedValue(INGESTED),
    listDoneBangumiIds: vi.fn<CronDependencies["listDoneBangumiIds"]>().mockResolvedValue(new Set<string>()),
    listStaleBangumiIds: vi.fn<CronDependencies["listStaleBangumiIds"]>().mockResolvedValue([]),
    runDailyIngest: vi.fn<CronDependencies["runDailyIngest"]>().mockResolvedValue({ status: "complete", runId: "daily-2026-08-14", createdAt: "2026-08-14T00:00:00Z" }),
    snapshotStore: vi.fn<CronDependencies["snapshotStore"]>().mockReturnValue(null),
    publishRun: vi.fn<CronDependencies["publishRun"]>().mockResolvedValue({ status: "invalid", reason: "no-op" }),
    gcSnapshots: vi.fn<CronDependencies["gcSnapshots"]>().mockResolvedValue({ deleted: 0, retained: [] }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("scheduled handler", () => {
  it("routes the daily 04:00 UTC seed cron to the seed job", async () => {
    const deps = dependencies();
    const done = vi.mocked(deps.listDoneBangumiIds).mockResolvedValue(
      new Set(SEED_BANGUMI_IDS.slice(0, 3)),
    );

    await createScheduledHandler(deps)({ cron: SEED_CRON }, ENV);

    expect(SEED_CRON).toBe("0 4 * * *");
    expect(done).toHaveBeenCalledWith(db, SEED_BANGUMI_IDS);
    expect(deps.listStaleBangumiIds).not.toHaveBeenCalled();
    expect(deps.ingestBangumi).toHaveBeenCalledTimes(SEED_BANGUMI_IDS.length - 3);
  });

  it("routes the hourly :17 TTL refresh cron to the TTL job", async () => {
    const deps = dependencies();
    const stale = vi.mocked(deps.listStaleBangumiIds).mockResolvedValue(["1", "2"]);

    await createScheduledHandler(deps)({ cron: TTL_REFRESH_CRON }, ENV);

    expect(TTL_REFRESH_CRON).toBe("17 * * * *");
    expect(stale).toHaveBeenCalledWith(db, TTL_BATCH_CAP);
    expect(deps.listDoneBangumiIds).not.toHaveBeenCalled();
    expect(deps.ingestBangumi).toHaveBeenCalledTimes(2);
  });

  it("routes the daily 06:00 UTC discovery cron to the daily run", async () => {
    const deps = dependencies();
    const runDaily = vi.mocked(deps.runDailyIngest);

    await createScheduledHandler(deps)({ cron: DAILY_DISCOVER_CRON }, ENV);

    expect(DAILY_DISCOVER_CRON).toBe("0 6 * * *");
    expect(runDaily).toHaveBeenCalledTimes(1);
    expect(deps.ingestBangumi).not.toHaveBeenCalled();
  });

  it("fails closed when the catalog DSN is absent", async () => {
    const deps = dependencies();

    await expect(createScheduledHandler(deps)({ cron: SEED_CRON }, {})).rejects.toThrow(
      "catalog database not configured",
    );
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it("fails an unknown cron instead of silently running the wrong job", async () => {
    const deps = dependencies();

    await expect(createScheduledHandler(deps)({ cron: "0 0 * * *" }, ENV)).rejects.toThrow(
      "Unknown catalog cron: 0 0 * * *",
    );
    expect(deps.ingestBangumi).not.toHaveBeenCalled();
  });

  it("constructs the default dependencies without opening a database connection", async () => {
    await expect(
      createScheduledHandler()({ cron: "0 0 * * *" }, ENV),
    ).rejects.toThrow("Unknown catalog cron: 0 0 * * *");
  });
});


describe("bangumiSeasonResolver (MAJOR-1)", () => {
  it("resolves current-season ids from the Bangumi calendar via the injected fetch", async () => {
    const { fetch } = mockFetch([{ weekday: { en: "mon" }, items: [{ id: 7 }, { id: 8 }] }]);
    const resolver = bangumiSeasonResolver({ fetchImpl: fetch, bangumiBaseUrl: "https://bgm.test" });
    await expect(resolver()).resolves.toEqual(["7", "8"]);
  });

  it("degrades to an empty season on an upstream failure so discovery still runs", async () => {
    const { fetch } = mockFetch(null, { ok: false, status: 503 });
    const resolver = bangumiSeasonResolver({ fetchImpl: fetch, bangumiBaseUrl: "https://bgm.test" });
    await expect(resolver()).resolves.toEqual([]);
  });
});
describe("seed job", () => {
  it("skips works that already have a done ingest_jobs row", async () => {
    const doneIds = new Set(SEED_BANGUMI_IDS.slice(0, 3));
    const deps = dependencies({
      listDoneBangumiIds: vi.fn<CronDependencies["listDoneBangumiIds"]>().mockResolvedValue(doneIds),
    });

    await expect(runSeedJob(db, deps)).resolves.toEqual(result(SEED_BANGUMI_IDS.length - 3, 7));
    expect(deps.ingestBangumi).toHaveBeenCalledTimes(SEED_BANGUMI_IDS.length - 3);
    const skipped = vi.mocked(deps.ingestBangumi).mock.calls.map(([, id]) => id);
    expect(skipped.some((id) => doneIds.has(id))).toBe(false);
  });

  it("counts non-ingested outcomes (in_progress/empty/failed) as skipped", async () => {
    const deps = dependencies();
    vi.mocked(deps.ingestBangumi).mockResolvedValueOnce(IN_PROGRESS).mockResolvedValue(INGESTED);

    await expect(runSeedJob(db, deps)).resolves.toEqual(result(SEED_BANGUMI_IDS.length, 9));
  });

  it("keeps ingesting the rest when one work's ingest throws", async () => {
    const deps = dependencies();
    vi.mocked(deps.ingestBangumi)
      .mockRejectedValueOnce(new Error("upstream exploded"))
      .mockResolvedValue(INGESTED);

    await expect(runSeedJob(db, deps)).resolves.toEqual(result(SEED_BANGUMI_IDS.length, 9));
    expect(deps.ingestBangumi).toHaveBeenCalledTimes(SEED_BANGUMI_IDS.length);
  });
});

describe("TTL job", () => {
  it("respects the batch cap when more works are stale than the cap", async () => {
    const twelveStale = Array.from({ length: 12 }, (_, i) => String(i + 1));
    const deps = dependencies({
      listStaleBangumiIds: vi.fn<CronDependencies["listStaleBangumiIds"]>().mockResolvedValue(twelveStale),
    });

    await expect(runTtlJob(db, deps)).resolves.toEqual(result(TTL_BATCH_CAP, TTL_BATCH_CAP));
    expect(deps.listStaleBangumiIds).toHaveBeenCalledWith(db, TTL_BATCH_CAP);
    expect(deps.ingestBangumi).toHaveBeenCalledTimes(TTL_BATCH_CAP);
    const ingested = vi.mocked(deps.ingestBangumi).mock.calls.map(([, id]) => id);
    expect(ingested).toEqual(twelveStale.slice(0, TTL_BATCH_CAP));
  });

  it("ingests every stale work when the list is under the cap", async () => {
    const deps = dependencies({
      listStaleBangumiIds: vi.fn<CronDependencies["listStaleBangumiIds"]>().mockResolvedValue([
        "1",
        "2",
        "3",
      ]),
    });

    await expect(runTtlJob(db, deps)).resolves.toEqual(result(3, 3));
    expect(deps.ingestBangumi).toHaveBeenCalledTimes(3);
  });
});
