import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { CRON_PASS_DEADLINE_MS, DAILY_DISCOVER_CRON, SEED_CRON, TTL_BATCH_CAP, TTL_REFRESH_CRON } from "../src/cron-config";
import {
  createScheduledHandler,
  type CronDependencies,
} from "../src/scheduled/ingest-schedule";
import type { IngestResult } from "../src/ingest/ingest-bangumi";
import { SEED_BANGUMI_IDS } from "../src/ingest/seed-works";
import type { UpstreamAccess } from "../src/ingest/sources";
import { deferred } from "./deferred";
import { abortTimeoutsOnFakeClock } from "./fakes/abort-timeout";
import { unanswered } from "./fakes/unanswered-request";
import { unreachableCatalogPrisma } from "./fakes/fake-catalog-prisma";

// SUT: the scheduled handler — which job a cron string routes to, and what it
// refuses. What each job does once routed is `cron-jobs.worker.test.ts`.
// Production lineage: the per-env AC1 guard allows ingest crons only in
// production, so the routing tests below run as the production environment.
const ENV = { DATABASE_URL: "postgresql://user:password@catalog.example/animichi", ENVIRONMENT: "production" };
const INGESTED: IngestResult = { status: "ingested", version: 1, pointCount: 4 };
/**
 * The cron's Prisma seam. Every dependency below is injected, so this seam is
 * never reached — a real build of it would assert that by failing loudly if the
 * wiring ever did touch it.
 */
const query = unreachableCatalogPrisma();

/** The one database seam every cron kind runs on, as the dependencies hand it over. */
function seams(): Pick<CronDependencies, "connectPrisma"> {
  return {
    connectPrisma: vi.fn<CronDependencies["connectPrisma"]>()
      .mockResolvedValue({ query, dispose: () => Promise.resolve() }),
  };
}

function dependencies(overrides: Partial<CronDependencies> = {}): CronDependencies {
  return {
    ...seams(),
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

let errorSpy: MockInstance<(...args: unknown[]) => void>;
let logSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy.mockClear();
  logSpy.mockClear();
});

describe("scheduled handler", () => {
  it("routes the daily 04:00 UTC seed cron to the seed job", async () => {
    const deps = dependencies();
    const done = vi.mocked(deps.listDoneBangumiIds).mockResolvedValue(
      new Set(SEED_BANGUMI_IDS.slice(0, 3)),
    );

    await createScheduledHandler(deps)({ cron: SEED_CRON }, ENV);

    expect(SEED_CRON).toBe("0 4 * * *");
    const [doneSeam, ids] = done.mock.calls[0] ?? [];
    expect(doneSeam).toBe(query);
    expect(ids).toEqual(SEED_BANGUMI_IDS);
    expect(deps.listStaleBangumiIds).not.toHaveBeenCalled();
    expect(deps.ingestBangumi).toHaveBeenCalledTimes(SEED_BANGUMI_IDS.length - 3);
  });

  it("routes the hourly :17 TTL refresh cron to the TTL job", async () => {
    const deps = dependencies();
    const stale = vi.mocked(deps.listStaleBangumiIds).mockResolvedValue(["1", "2"]);

    await createScheduledHandler(deps)({ cron: TTL_REFRESH_CRON }, ENV);

    expect(TTL_REFRESH_CRON).toBe("17 * * * *");
    const [staleSeam, cap] = stale.mock.calls[0] ?? [];
    expect(staleSeam).toBe(query);
    expect(cap).toBe(TTL_BATCH_CAP);
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

});

describe("scheduled handler refusals", () => {
  it("fails closed when the catalog DSN is absent", async () => {
    const deps = dependencies();

    await expect(createScheduledHandler(deps)({ cron: SEED_CRON }, {})).rejects.toThrow(
      "catalog database not configured",
    );
    expect(deps.connectPrisma).not.toHaveBeenCalled();
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

/** An ingest that holds its work until the pass's signal aborts, then rejects with that signal's reason. */
function heldUntilAborted(upstream: UpstreamAccess): Promise<IngestResult> {
  return unanswered(upstream.signal ?? new AbortController().signal);
}

describe("scheduled handler pass deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts the work in flight when the pass's deadline passes and starts no further work", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    abortTimeoutsOnFakeClock();
    const reached = deferred();
    const ingest = vi.fn<CronDependencies["ingestBangumi"]>((_query, _id, upstream) => {
      reached.settle();
      return heldUntilAborted(upstream);
    });
    const stale = vi.fn<CronDependencies["listStaleBangumiIds"]>().mockResolvedValue(["1", "2", "3"]);
    const pass = createScheduledHandler(dependencies({ ingestBangumi: ingest, listStaleBangumiIds: stale }))({ cron: TTL_REFRESH_CRON }, ENV);
    await reached.promise;
    const deadline = ingest.mock.calls[0]?.[2].signal;
    await vi.advanceTimersByTimeAsync(CRON_PASS_DEADLINE_MS - 1);
    expect(deadline?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pass;
    expect(deadline?.aborted).toBe(true);
    expect(ingest).toHaveBeenCalledTimes(1);
  });
});
