import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SEED_CRON,
  TTL_BATCH_CAP,
  TTL_REFRESH_CRON,
  createScheduledHandler,
  runSeedJob,
  runTtlJob,
  type CronDependencies,
  type CronJobResult,
} from "../src/index";
import type { IngestResult } from "../src/ingest/orchestrator";
import type { CatalogDb } from "../src/db/client";
import { SEED_WORK_IDS } from "../src/ingest/seed-works";

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
    ingestWork: vi.fn<CronDependencies["ingestWork"]>().mockResolvedValue(INGESTED),
    listDoneWorkIds: vi.fn<CronDependencies["listDoneWorkIds"]>().mockResolvedValue(new Set<string>()),
    listStaleWorkIds: vi.fn<CronDependencies["listStaleWorkIds"]>().mockResolvedValue([]),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("scheduled handler", () => {
  it("routes the daily 04:00 UTC seed cron to the seed job", async () => {
    const deps = dependencies();
    const done = vi.mocked(deps.listDoneWorkIds).mockResolvedValue(
      new Set(SEED_WORK_IDS.slice(0, 3)),
    );

    await createScheduledHandler(deps)({ cron: SEED_CRON }, ENV);

    expect(SEED_CRON).toBe("0 4 * * *");
    expect(done).toHaveBeenCalledWith(db, SEED_WORK_IDS);
    expect(deps.listStaleWorkIds).not.toHaveBeenCalled();
    expect(deps.ingestWork).toHaveBeenCalledTimes(SEED_WORK_IDS.length - 3);
  });

  it("routes the hourly :17 TTL refresh cron to the TTL job", async () => {
    const deps = dependencies();
    const stale = vi.mocked(deps.listStaleWorkIds).mockResolvedValue(["1", "2"]);

    await createScheduledHandler(deps)({ cron: TTL_REFRESH_CRON }, ENV);

    expect(TTL_REFRESH_CRON).toBe("17 * * * *");
    expect(stale).toHaveBeenCalledWith(db, TTL_BATCH_CAP);
    expect(deps.listDoneWorkIds).not.toHaveBeenCalled();
    expect(deps.ingestWork).toHaveBeenCalledTimes(2);
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
    expect(deps.ingestWork).not.toHaveBeenCalled();
  });

  it("constructs the default dependencies without opening a database connection", async () => {
    await expect(
      createScheduledHandler()({ cron: "0 0 * * *" }, ENV),
    ).rejects.toThrow("Unknown catalog cron: 0 0 * * *");
  });
});

describe("seed job", () => {
  it("skips works that already have a done ingest_jobs row", async () => {
    const doneIds = new Set(SEED_WORK_IDS.slice(0, 3));
    const deps = dependencies({
      listDoneWorkIds: vi.fn<CronDependencies["listDoneWorkIds"]>().mockResolvedValue(doneIds),
    });

    await expect(runSeedJob(db, deps)).resolves.toEqual(result(SEED_WORK_IDS.length - 3, 7));
    expect(deps.ingestWork).toHaveBeenCalledTimes(SEED_WORK_IDS.length - 3);
    const skipped = vi.mocked(deps.ingestWork).mock.calls.map(([, id]) => id);
    expect(skipped.some((id) => doneIds.has(id))).toBe(false);
  });

  it("counts non-ingested outcomes (in_progress/empty/failed) as skipped", async () => {
    const deps = dependencies();
    vi.mocked(deps.ingestWork).mockResolvedValueOnce(IN_PROGRESS).mockResolvedValue(INGESTED);

    await expect(runSeedJob(db, deps)).resolves.toEqual(result(SEED_WORK_IDS.length, 9));
  });

  it("keeps ingesting the rest when one work's ingest throws", async () => {
    const deps = dependencies();
    vi.mocked(deps.ingestWork)
      .mockRejectedValueOnce(new Error("upstream exploded"))
      .mockResolvedValue(INGESTED);

    await expect(runSeedJob(db, deps)).resolves.toEqual(result(SEED_WORK_IDS.length, 9));
    expect(deps.ingestWork).toHaveBeenCalledTimes(SEED_WORK_IDS.length);
  });
});

describe("TTL job", () => {
  it("respects the batch cap when more works are stale than the cap", async () => {
    const twelveStale = Array.from({ length: 12 }, (_, i) => String(i + 1));
    const deps = dependencies({
      listStaleWorkIds: vi.fn<CronDependencies["listStaleWorkIds"]>().mockResolvedValue(twelveStale),
    });

    await expect(runTtlJob(db, deps)).resolves.toEqual(result(TTL_BATCH_CAP, TTL_BATCH_CAP));
    expect(deps.listStaleWorkIds).toHaveBeenCalledWith(db, TTL_BATCH_CAP);
    expect(deps.ingestWork).toHaveBeenCalledTimes(TTL_BATCH_CAP);
    const ingested = vi.mocked(deps.ingestWork).mock.calls.map(([, id]) => id);
    expect(ingested).toEqual(twelveStale.slice(0, TTL_BATCH_CAP));
  });

  it("ingests every stale work when the list is under the cap", async () => {
    const deps = dependencies({
      listStaleWorkIds: vi.fn<CronDependencies["listStaleWorkIds"]>().mockResolvedValue([
        "1",
        "2",
        "3",
      ]),
    });

    await expect(runTtlJob(db, deps)).resolves.toEqual(result(3, 3));
    expect(deps.ingestWork).toHaveBeenCalledTimes(3);
  });
});
