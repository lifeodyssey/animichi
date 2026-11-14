/**
 * SUT: the cron job runners in `src/scheduled/cron-jobs.ts` — which works each
 * job hands to the ingest, and the summary it returns, in which every attempted
 * work lands in exactly one of ingested, skipped or failed. How the scheduled
 * handler routes a cron to these runners is `cron.worker.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TTL_BATCH_CAP } from "../src/cron-config";
import type { IngestResult } from "../src/ingest/ingest-bangumi";
import { SEED_BANGUMI_IDS } from "../src/ingest/seed-works";
import { bangumiSeasonResolver, runSeedJob, runTtlJob } from "../src/scheduled/cron-jobs";
import type { CronDependencies } from "../src/scheduled/ingest-schedule";
import { unreachableCatalogPrisma } from "./fakes/fake-catalog-prisma";
import { mockFetch } from "./mock-fetch-sequence";

const INGESTED: IngestResult = { status: "ingested", version: 1, pointCount: 4 };
const IN_PROGRESS: IngestResult = { status: "in_progress" };
const EMPTY: IngestResult = { status: "empty", reason: "no points" };
const FAILED: IngestResult = { status: "failed", reason: "enrich failed" };
/** The pass's Prisma seam; every dependency is injected, so a job never reaches it. */
const query = unreachableCatalogPrisma();

function dependencies(overrides: Partial<CronDependencies> = {}): CronDependencies {
  return {
    connectPrisma: vi.fn<CronDependencies["connectPrisma"]>()
      .mockResolvedValue({ query, dispose: () => Promise.resolve() }),
    ingestBangumi: vi.fn<CronDependencies["ingestBangumi"]>().mockResolvedValue(INGESTED),
    listDoneBangumiIds: vi.fn<CronDependencies["listDoneBangumiIds"]>().mockResolvedValue(new Set<string>()),
    listDrainableBangumiIds: vi.fn<CronDependencies["listDrainableBangumiIds"]>().mockResolvedValue([]),
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

/** A TTL job over `stale`, whose ingests answer in that order. */
function staleWorks(stale: readonly string[], ingest: CronDependencies["ingestBangumi"]): CronDependencies {
  return dependencies({
    listStaleBangumiIds: vi.fn<CronDependencies["listStaleBangumiIds"]>().mockResolvedValue(stale),
    ingestBangumi: ingest,
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("seed job", () => {
  it("skips works that already have a done ingest_jobs row", async () => {
    const doneIds = new Set(SEED_BANGUMI_IDS.slice(0, 3));
    const deps = dependencies({
      listDoneBangumiIds: vi.fn<CronDependencies["listDoneBangumiIds"]>().mockResolvedValue(doneIds),
    });

    await expect(runSeedJob(query, deps)).resolves.toEqual({ attempted: SEED_BANGUMI_IDS.length - 3, ingested: 7, skipped: 0, failed: 0 });
    expect(deps.ingestBangumi).toHaveBeenCalledTimes(SEED_BANGUMI_IDS.length - 3);
    const skipped = vi.mocked(deps.ingestBangumi).mock.calls.map(([, id]) => id);
    expect(skipped.some((id) => doneIds.has(id))).toBe(false);
  });

  it("counts a work another invocation holds as skipped, not failed", async () => {
    const deps = dependencies();
    vi.mocked(deps.ingestBangumi).mockResolvedValueOnce(IN_PROGRESS).mockResolvedValue(INGESTED);

    await expect(runSeedJob(query, deps)).resolves.toEqual({ attempted: SEED_BANGUMI_IDS.length, ingested: 9, skipped: 1, failed: 0 });
  });

  it("counts a thrown ingest as failed and keeps ingesting the rest", async () => {
    const deps = dependencies();
    vi.mocked(deps.ingestBangumi)
      .mockRejectedValueOnce(new Error("upstream exploded"))
      .mockResolvedValue(INGESTED);

    await expect(runSeedJob(query, deps)).resolves.toEqual({ attempted: SEED_BANGUMI_IDS.length, ingested: 9, skipped: 0, failed: 1 });
    expect(deps.ingestBangumi).toHaveBeenCalledTimes(SEED_BANGUMI_IDS.length);
  });
});

describe("TTL job", () => {
  it("respects the batch cap when more works are stale than the cap", async () => {
    const twelveStale = Array.from({ length: 12 }, (_, i) => String(i + 1));
    const deps = dependencies({
      listStaleBangumiIds: vi.fn<CronDependencies["listStaleBangumiIds"]>().mockResolvedValue(twelveStale),
    });

    await expect(runTtlJob(query, deps)).resolves.toEqual({ attempted: TTL_BATCH_CAP, ingested: TTL_BATCH_CAP, skipped: 0, failed: 0 });
    const [staleSeam, cap] = vi.mocked(deps.listStaleBangumiIds).mock.calls[0] ?? [];
    expect(staleSeam).toBe(query);
    expect(cap).toBe(TTL_BATCH_CAP);
    expect(deps.ingestBangumi).toHaveBeenCalledTimes(TTL_BATCH_CAP);
    const ingested = vi.mocked(deps.ingestBangumi).mock.calls.map(([, id]) => id);
    expect(ingested).toEqual(twelveStale.slice(0, TTL_BATCH_CAP));
  });

  it("ingests every stale work when the list is under the cap", async () => {
    const deps = staleWorks(["1", "2", "3"], vi.fn<CronDependencies["ingestBangumi"]>().mockResolvedValue(INGESTED));

    await expect(runTtlJob(query, deps)).resolves.toEqual({ attempted: 3, ingested: 3, skipped: 0, failed: 0 });
    expect(deps.ingestBangumi).toHaveBeenCalledTimes(3);
  });

  it("lands each attempted work in exactly one of ingested, skipped or failed", async () => {
    const ingest = vi.fn<CronDependencies["ingestBangumi"]>()
      .mockResolvedValueOnce(INGESTED)
      .mockResolvedValueOnce(IN_PROGRESS)
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce(FAILED);

    await expect(runTtlJob(query, staleWorks(["1", "2", "3", "4"], ingest)))
      .resolves.toEqual({ attempted: 4, ingested: 1, skipped: 2, failed: 1 });
  });

  it("reports a pass in which every ingest fails as failed = attempted", async () => {
    const ingest = vi.fn<CronDependencies["ingestBangumi"]>().mockResolvedValue(FAILED);

    await expect(runTtlJob(query, staleWorks(["1", "2", "3"], ingest)))
      .resolves.toEqual({ attempted: 3, ingested: 0, skipped: 0, failed: 3 });
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
