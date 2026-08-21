/**
 * Daily snapshot publish wiring (issue #1012 AC3) — worker test.
 *
 * Proves the composition root gates the immutable-snapshot publish to fully
 * successful daily runs: a complete run publishes the snapshot (real
 * publishSnapshot against an in-memory store) and then schedules the N/N-1 GC; a
 * failed run never publishes (AC6 — no partial publishes). Driven through the
 * same injectable CronDependencies the scheduled handler uses.
 */
import { describe, expect, it, vi } from "vitest";
import { createScheduledHandler, type CronDependencies } from "../src/scheduled/ingest-schedule";
import { publishAfterRun, type DailyRunOutcome } from "../src/publish/daily-snapshot";
import { publishSnapshot } from "../src/publish/snapshot";
import { gcSnapshots } from "../src/publish/snapshot-gc";
import { fakeCatalogDb } from "./fakes/fake-catalog-db";
import { inMemoryObjectStore } from "./fakes/in-memory-object-store";
import { DAILY_DISCOVER_CRON } from "../src/cron-config";

// Daily-snapshot publish is a production-lineage behaviour (the daily ingest
// discover cron runs only in production per the per-env AC1 guard).
const ENV = { DATABASE_URL: "postgresql://u:p@host/db", ENVIRONMENT: "production" };
const db = fakeCatalogDb({});

/** A complete run outcome carrying the real run id + createdAt the gate must thread through. */
const COMPLETE: DailyRunOutcome = { status: "complete", runId: "daily-2026-08-14", createdAt: "2026-08-14T00:00:00Z" };

/** The four seams the publish gate depends on, in-memory store + real publish. */
function gateDeps(overrides: Partial<CronDependencies> = {}): CronDependencies {
  const store = inMemoryObjectStore().store;
  return {
    connect: vi.fn<CronDependencies["connect"]>().mockResolvedValue(db),
    ingestBangumi: vi.fn<CronDependencies["ingestBangumi"]>().mockResolvedValue({ status: "ingested", version: 1, pointCount: 4 }),
    listDoneBangumiIds: vi.fn<CronDependencies["listDoneBangumiIds"]>().mockResolvedValue(new Set()),
    listStaleBangumiIds: vi.fn<CronDependencies["listStaleBangumiIds"]>().mockResolvedValue([]),
    runDailyIngest: vi.fn<CronDependencies["runDailyIngest"]>().mockResolvedValue(COMPLETE),
    snapshotStore: vi.fn<CronDependencies["snapshotStore"]>().mockReturnValue(store),
    publishRun: vi.fn<CronDependencies["publishRun"]>().mockImplementation((d, s, runId, at) =>
      publishSnapshot({ db: d, store: s }, { sourceRunId: runId, createdAt: at }),
    ),
    gcSnapshots: vi.fn<CronDependencies["gcSnapshots"]>().mockImplementation((s) => gcSnapshots(s, 2)),
    importSource: vi.fn<CronDependencies["importSource"]>().mockReturnValue(null),
    runImport: vi.fn<CronDependencies["runImport"]>().mockResolvedValue({ status: "invalid", reason: "no-op" }),
    ...overrides,
  };
}

describe("daily snapshot publish gate (AC3/AC6)", () => {
  it("a complete run publishes a snapshot AND then runs the N/N-1 GC", async () => {
    const store = inMemoryObjectStore().store;
    const deps = gateDeps({ snapshotStore: vi.fn().mockReturnValue(store) });
    const publish = deps.publishRun as ReturnType<typeof vi.fn>;
    const gc = deps.gcSnapshots as ReturnType<typeof vi.fn>;

    await createScheduledHandler(deps)({ cron: DAILY_DISCOVER_CRON }, ENV);

    expect(deps.runDailyIngest).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    const first = await (publish.mock.results[0]?.value as Promise<unknown> | undefined);
    expect(first).toMatchObject({ status: "published" });
    expect(gc).toHaveBeenCalledTimes(1);
  });

  it("a failed run never publishes (AC6: no partial publishes)", async () => {
    const deps = gateDeps({
      runDailyIngest: vi.fn<CronDependencies["runDailyIngest"]>().mockResolvedValue({ status: "failed", runId: "daily-x", createdAt: "t" }),
    });
    await createScheduledHandler(deps)({ cron: DAILY_DISCOVER_CRON }, ENV);
    expect(deps.publishRun).not.toHaveBeenCalled();
    expect(deps.gcSnapshots).not.toHaveBeenCalled();
  });

  it("a partial (not complete) run never publishes", async () => {
    const deps = gateDeps({
      runDailyIngest: vi.fn<CronDependencies["runDailyIngest"]>().mockResolvedValue({ status: "partial", runId: "daily-x", createdAt: "t" }),
    });
    await createScheduledHandler(deps)({ cron: DAILY_DISCOVER_CRON }, ENV);
    expect(deps.publishRun).not.toHaveBeenCalled();
  });

  it("no publish without a snapshot bucket binding", async () => {
    const deps = gateDeps({
      snapshotStore: vi.fn().mockReturnValue(null),
    });
    await createScheduledHandler(deps)({ cron: DAILY_DISCOVER_CRON }, { DATABASE_URL: "dsn", ENVIRONMENT: "production" });
    expect(deps.runDailyIngest).toHaveBeenCalledTimes(1);
    expect(deps.publishRun).not.toHaveBeenCalled();
    expect(deps.gcSnapshots).not.toHaveBeenCalled();
  });
});

describe("publishAfterRun unit gate", () => {
  it("publishes then GCs when the run is complete and a store is present", async () => {
    const store = inMemoryObjectStore().store;
    const run = vi.fn().mockResolvedValue(COMPLETE);
    const publish = vi.fn().mockResolvedValue({ status: "published", snapshot: {} });
    const gc = vi.fn().mockResolvedValue({ deleted: 0, retained: [] });
    await publishAfterRun(db, store, {
      runDailyIngest: run, publishRun: publish, gcSnapshots: gc,
    });
    expect(run).toHaveBeenCalledWith(db, store);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(db, store, COMPLETE.runId, COMPLETE.createdAt);
    expect(gc).toHaveBeenCalledTimes(1);
  });

  it("does not publish when validation rejects the candidate", async () => {
    const store = inMemoryObjectStore().store;
    const publish = vi.fn().mockResolvedValue({ status: "invalid", reason: "bad" });
    const gc = vi.fn().mockResolvedValue({ deleted: 0, retained: [] });
    await publishAfterRun(db, store, {
      runDailyIngest: vi.fn().mockResolvedValue(COMPLETE),
      publishRun: publish, gcSnapshots: gc,
    });
    expect(gc).not.toHaveBeenCalled();
  });

  it("threads the completed run's own runId and createdAt into publishRun (never the wall clock)", async () => {
    const store = inMemoryObjectStore().store;
    const publish = vi.fn().mockResolvedValue({ status: "published", snapshot: {} });
    const gc = vi.fn().mockResolvedValue({ deleted: 0, retained: [] });
    await publishAfterRun(db, store, {
      runDailyIngest: vi.fn().mockResolvedValue({ status: "complete", runId: "daily-2026-08-30", createdAt: "2026-08-30T04:00:00Z" }),
      publishRun: publish, gcSnapshots: gc,
    });
    expect(publish).toHaveBeenCalledWith(db, store, "daily-2026-08-30", "2026-08-30T04:00:00Z");
  });
});
