/**
 * Per-environment schedule guard (issue #1016, AC1) — unit test.
 *
 * Proves production alone runs upstream ingest, staging owns daily import,
 * both deployed environments may drain pending work, and handlers fail closed on a wrong-
 * routed cron (a staging env receiving an ingest event no-ops; any env
 * receiving the import cron without an import source no-ops). Also pins the
 * operational defaults from the spec (§314) in the operational-config module.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DAILY_DISCOVER_CRON,
  DAILY_IMPORT_CRON,
  PENDING_DRAIN_CRON,
  SEED_CRON,
  TTL_REFRESH_CRON,
} from "../src/cron-config";
import { cronKind, guardCron } from "../src/import/schedule";
import { createScheduledHandler, type CronDependencies } from "../src/scheduled/ingest-schedule";
import {
  PRODUCTION_STALE_SECONDS,
  STAGING_STALE_SECONDS,
  allowsImportCron,
  allowsIngestCron,
  allowsPendingDrainCron,
  runtimeEnvironment,
} from "../src/operational-config";
import type { CatalogDb } from "../src/db/client";
import { fakeSnapshotSource } from "./fakes/fake-snapshot-source";

const db = {} as unknown as CatalogDb;
const PROD = { DATABASE_URL: "postgresql://u:p@host/db", ENVIRONMENT: "production" };
const STAGING = { DATABASE_URL: "postgresql://u:p@host/staging", ENVIRONMENT: "staging" };

function deps(overrides: Partial<CronDependencies> = {}): CronDependencies {
  return {
    connect: vi.fn<CronDependencies["connect"]>().mockResolvedValue(db),
    ingestBangumi: vi.fn<CronDependencies["ingestBangumi"]>().mockResolvedValue({ status: "ingested", version: 1, pointCount: 4 }),
    listDoneBangumiIds: vi.fn<CronDependencies["listDoneBangumiIds"]>().mockResolvedValue(new Set()),
    listDrainableBangumiIds: vi.fn<CronDependencies["listDrainableBangumiIds"]>().mockResolvedValue([]),
    listStaleBangumiIds: vi.fn<CronDependencies["listStaleBangumiIds"]>().mockResolvedValue([]),
    runDailyIngest: vi.fn<CronDependencies["runDailyIngest"]>().mockResolvedValue({ status: "complete", runId: "daily-2026-08-14", createdAt: "t" }),
    snapshotStore: vi.fn<CronDependencies["snapshotStore"]>().mockReturnValue(null),
    publishRun: vi.fn<CronDependencies["publishRun"]>().mockResolvedValue({ status: "invalid", reason: "no-op" }),
    gcSnapshots: vi.fn<CronDependencies["gcSnapshots"]>().mockResolvedValue({ deleted: 0, retained: [] }),
    importSource: vi.fn<CronDependencies["importSource"]>().mockReturnValue(fakeSnapshotSource().source),
    runImport: vi.fn<CronDependencies["runImport"]>().mockResolvedValue({ status: "imported", snapshotId: "snap-daily-1" }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("cron classification (AC1)", () => {
  it("classifies the cron strings", () => {
    expect(cronKind(SEED_CRON)).toBe("seed");
    expect(cronKind(TTL_REFRESH_CRON)).toBe("ttl");
    expect(cronKind(PENDING_DRAIN_CRON)).toBe("pendingDrain");
    expect(cronKind(DAILY_DISCOVER_CRON)).toBe("dailyDiscover");
    expect(cronKind(DAILY_IMPORT_CRON)).toBe("dailyImport");
  });

  it("classifies an unknown cron as unknown", () => {
    expect(cronKind("0 0 * * *")).toBe("unknown");
  });
});

describe("environment guard (AC1)", () => {
  it("allows ingest crons only in production", () => {
    expect(allowsIngestCron("production")).toBe(true);
    expect(allowsIngestCron("staging")).toBe(false);
    expect(allowsIngestCron("development")).toBe(false);
    expect(guardCron(cronKind(SEED_CRON), "staging").denied).toBe(true);
    expect(guardCron(cronKind(DAILY_DISCOVER_CRON), "production").denied).toBe(false);
  });

  it("denies an unknown cron in any environment (fail-closed)", () => {
    expect(guardCron("unknown", "production").denied).toBe(true);
    expect(guardCron("unknown", "staging").denied).toBe(true);
    expect(guardCron("unknown", "development").denied).toBe(true);
  });

  it("allows the import cron only in staging", () => {
    expect(allowsImportCron("staging")).toBe(true);
    expect(allowsImportCron("production")).toBe(false);
    expect(guardCron(cronKind(DAILY_IMPORT_CRON), "production").denied).toBe(true);
    expect(guardCron(cronKind(DAILY_IMPORT_CRON), "development").denied).toBe(true);
    expect(guardCron(cronKind(DAILY_IMPORT_CRON), "staging").denied).toBe(false);
  });

  it("allows the pending drain only in deployed environments", () => {
    expect(allowsPendingDrainCron("staging")).toBe(true);
    expect(allowsPendingDrainCron("production")).toBe(true);
    expect(allowsPendingDrainCron("development")).toBe(false);
    expect(guardCron(cronKind(PENDING_DRAIN_CRON), "development").denied).toBe(true);
  });
});

describe("runtimeEnvironment (operational config)", () => {
  it("fails closed to development on malformed/absent values", () => {
    expect(runtimeEnvironment("production")).toBe("production");
    expect(runtimeEnvironment("staging")).toBe("staging");
    expect(runtimeEnvironment(undefined)).toBe("development");
    expect(runtimeEnvironment("prod")).toBe("development");
    expect(runtimeEnvironment("")).toBe("development");
  });
});

describe("operational defaults (§314)", () => {
  it("pins production stale at 36h and staging stale at 48h in operational-config", () => {
    expect(PRODUCTION_STALE_SECONDS).toBe(36 * 60 * 60);
    expect(STAGING_STALE_SECONDS).toBe(48 * 60 * 60);
  });
});

describe("scheduled handler per-environment dispatch (AC1)", () => {
  it("no-ops an ingest cron that reaches a staging environment (fail-closed)", async () => {
    const handle = deps();
    const ingest = vi.mocked(handle.ingestBangumi);
    await createScheduledHandler(handle)({ cron: SEED_CRON }, STAGING);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("runs an ingest cron in production", async () => {
    const handle = deps();
    await createScheduledHandler(handle)({ cron: SEED_CRON }, PROD);
    // The seed pass ingests every checked-in title (SEED_BANGUMI, 10 works)
    // that listDoneBangumiIds (mocked empty) doesn't already report done —
    // one call per bangumi id, over the connected db.
    expect(handle.ingestBangumi).toHaveBeenCalledTimes(10);
    expect(handle.ingestBangumi).toHaveBeenNthCalledWith(1, db, "160209");
    expect(handle.ingestBangumi).toHaveBeenNthCalledWith(10, db, "328609");
  });

  it("runs the import cron in staging through the injected import runner", async () => {
    const handle = deps();
    await createScheduledHandler(handle)({ cron: DAILY_IMPORT_CRON }, STAGING);
    expect(handle.runImport).toHaveBeenCalledTimes(1);
    expect(handle.ingestBangumi).not.toHaveBeenCalled();
  });

  it("no-ops the import cron in production", async () => {
    const handle = deps();
    await createScheduledHandler(handle)({ cron: DAILY_IMPORT_CRON }, PROD);
    expect(handle.runImport).not.toHaveBeenCalled();
  });

  it("no-ops the pending drain in development", async () => {
    const handle = deps();
    await createScheduledHandler(handle)({ cron: PENDING_DRAIN_CRON }, { DATABASE_URL: PROD.DATABASE_URL });
    expect(handle.listDrainableBangumiIds).not.toHaveBeenCalled();
  });

  it("no-ops the import cron when no import source is configured", async () => {
    const handle = deps({ importSource: vi.fn<CronDependencies["importSource"]>().mockReturnValue(null) });
    await createScheduledHandler(handle)({ cron: DAILY_IMPORT_CRON }, STAGING);
    expect(handle.runImport).toHaveBeenCalledWith(db, null);
  });
});
