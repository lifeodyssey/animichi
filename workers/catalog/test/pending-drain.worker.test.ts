import { describe, expect, it, vi } from "vitest";
import { Budget } from "../src/ingest/budgets";
import { PENDING_DRAIN_CRON, TTL_REFRESH_CRON } from "../src/cron-config";
import {
  createScheduledHandler,
  type CronDependencies,
} from "../src/scheduled/ingest-schedule";
import { unreachableCatalogPrisma } from "./fakes/fake-catalog-prisma";
import { runPendingDrainJob } from "../src/scheduled/cron-jobs";

/**
 * The cron's Prisma seam. Every dependency below is injected, so this seam is
 * never reached — a build of it that is asserted unreachable is what proves the
 * wiring used the injected one.
 */
const query = unreachableCatalogPrisma();
const DATABASE_URL = "postgresql://user:password@catalog.example/animichi";

const INGESTED = { status: "ingested", version: 1, pointCount: 2 } as const;
const BASE_DEPENDENCIES: CronDependencies = {
  connectPrisma: () => Promise.resolve({ query, dispose: () => Promise.resolve() }),
  connect: () => Promise.resolve({} as never),
  ingestBangumi: () => Promise.resolve(INGESTED),
  listDoneBangumiIds: () => Promise.resolve(new Set()),
  listDrainableBangumiIds: () => Promise.resolve([]),
  listStaleBangumiIds: () => Promise.resolve([]),
  runDailyIngest: () => Promise.resolve({ status: "complete", runId: "daily-test", createdAt: "2026-08-29T00:00:00Z" }),
  snapshotStore: () => null,
  publishRun: () => Promise.resolve({ status: "invalid", reason: "unused" }),
  gcSnapshots: () => Promise.resolve({ deleted: 0, retained: [] }),
  importSource: () => null,
  runImport: () => Promise.resolve({ status: "invalid", reason: "unused" }),
};

function dependencies(overrides: Partial<CronDependencies>): CronDependencies {
  return { ...BASE_DEPENDENCIES, ...overrides };
}

function ingestMock() {
  return vi.fn<CronDependencies["ingestBangumi"]>().mockResolvedValue(INGESTED);
}

describe("scheduled pending drain", () => {
  it("runs request-parked work from staging's drain cron", async () => {
    const ingestBangumi = ingestMock();
    const deps = dependencies({
      ingestBangumi,
      listDrainableBangumiIds: () => Promise.resolve(["pending-1"]),
    });

    await createScheduledHandler(deps)({ cron: PENDING_DRAIN_CRON }, {
      DATABASE_URL,
      ENVIRONMENT: "staging",
    });

    const [seamArg, id] = ingestBangumi.mock.calls[0] ?? [];
    expect(seamArg).toBe(query);
    expect(id).toBe("pending-1");
  });

  it("folds pending work into production's existing TTL cron", async () => {
    const ingestBangumi = ingestMock();
    const deps = dependencies({
      ingestBangumi,
      listDrainableBangumiIds: () => Promise.resolve(["pending-1"]),
    });

    await createScheduledHandler(deps)({ cron: TTL_REFRESH_CRON }, {
      DATABASE_URL,
      ENVIRONMENT: "production",
    });

    const [seamArg, id] = ingestBangumi.mock.calls[0] ?? [];
    expect(seamArg).toBe(query);
    expect(id).toBe("pending-1");
  });

  it("stops before a work that does not fit the shared budget", async () => {
    const ingestBangumi = ingestMock();
    const deps = dependencies({
      ingestBangumi,
      listDrainableBangumiIds: () => Promise.resolve(["pending-1", "pending-2"]),
    });
    const budget = new Budget({ workLimit: 1, requestLimit: 2, runtimeLimitMs: 60_000 });

    const result = await runPendingDrainJob(query, deps, budget);

    expect(result).toEqual({ attempted: 1, ingested: 1, skipped: 0 });
    expect(ingestBangumi).toHaveBeenCalledTimes(1);
  });
});
