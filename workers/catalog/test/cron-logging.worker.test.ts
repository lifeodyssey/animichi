import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { DAILY_IMPORT_CRON, SEED_CRON, TTL_REFRESH_CRON } from "../src/cron-config";
import { createScheduledHandler, type CronDependencies } from "../src/scheduled/ingest-schedule";
import type { IngestResult } from "../src/ingest/ingest-bangumi";
import type { CatalogDb } from "../src/db/client";
import { SEED_BANGUMI_IDS } from "../src/ingest/seed-works";

// Failure-signal audit (docs/specs/2026-08-26-system-health-audit.md sec 2.4): cron
// outcomes used to be computed and discarded. These pin the new log signals; the
// routing behaviour itself stays covered in cron.worker.test.ts.
const ENV = { DATABASE_URL: "postgresql://user:password@catalog.example/animichi", ENVIRONMENT: "production" };
const STAGING_ENV = { DATABASE_URL: "postgresql://user:password@catalog.example/animichi", ENVIRONMENT: "staging" };
const INGESTED: IngestResult = { status: "ingested", version: 1, pointCount: 4 };
const db = {} as unknown as CatalogDb;

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
    importSource: vi.fn<CronDependencies["importSource"]>().mockReturnValue(null),
    runImport: vi.fn<CronDependencies["runImport"]>().mockResolvedValue({ status: "invalid", reason: "no-op" }),
    ...overrides,
  };
}

let errorSpy: MockInstance<(...args: unknown[]) => void>;
let logSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy.mockClear();
  logSpy.mockClear();
});

describe("dailyImport cron result signal", () => {
  it("errors with the reason when the staging import is invalid", async () => {
    const deps = dependencies({
      runImport: vi.fn<CronDependencies["runImport"]>().mockResolvedValue({
        status: "invalid",
        reason: "snapshot objects unavailable",
      }),
    });

    await createScheduledHandler(deps)({ cron: DAILY_IMPORT_CRON }, STAGING_ENV);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("snapshot objects unavailable"),
    );
  });

  it("logs a success summary when the staging import activates a snapshot", async () => {
    const deps = dependencies({
      runImport: vi.fn<CronDependencies["runImport"]>().mockResolvedValue({
        status: "imported",
        snapshotId: "snap-2026-08-25",
      }),
    });

    await createScheduledHandler(deps)({ cron: DAILY_IMPORT_CRON }, STAGING_ENV);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("snap-2026-08-25"),
    );
  });
});

describe("cron completion summary", () => {
  it("logs attempted/ingested/skipped for the seed cron", async () => {
    const deps = dependencies({
      listDoneBangumiIds: vi.fn<CronDependencies["listDoneBangumiIds"]>().mockResolvedValue(
        new Set(SEED_BANGUMI_IDS.slice(0, 3)),
      ),
    });

    await createScheduledHandler(deps)({ cron: SEED_CRON }, ENV);

    expect(logSpy).toHaveBeenCalledWith(
      `seed cron: attempted=${String(SEED_BANGUMI_IDS.length - 3)} ingested=${String(SEED_BANGUMI_IDS.length - 3)} skipped=0`,
    );
  });

  it("logs attempted/ingested/skipped for the TTL cron", async () => {
    const deps = dependencies({
      listStaleBangumiIds: vi.fn<CronDependencies["listStaleBangumiIds"]>().mockResolvedValue(["1", "2"]),
    });

    await createScheduledHandler(deps)({ cron: TTL_REFRESH_CRON }, ENV);

    expect(logSpy).toHaveBeenCalledWith("ttl cron: attempted=2 ingested=2 skipped=0");
  });
});
