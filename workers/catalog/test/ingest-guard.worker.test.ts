import { describe, expect, it } from "vitest";
import { JobStore } from "../src/ingest/jobs";
import { fakeCatalogPrisma } from "./fakes/fake-catalog-prisma";
import { recordingCatalogPrisma } from "./fakes/plan-inspection";

/** A seam whose guard read answers `rows`; every statement is a plan. */
function dbWithRows(rows: object[]) {
  return fakeCatalogPrisma(rows);
}

describe("JobStore persisted ingest guard", () => {
  it("recognizes a live not-found marker as genuinely empty", async () => {
    const store = new JobStore(dbWithRows([
      { status: "failed", error_code: "not_found", running_live: false, cache_live: true },
    ]));
    await expect(store.guard("115908")).resolves.toBe("empty");
  });

  it("recognizes an ordinary live failure as recently attempted", async () => {
    const store = new JobStore(dbWithRows([
      { status: "failed", error_code: "ingest_error", running_live: false, cache_live: true },
    ]));
    await expect(store.guard("115908")).resolves.toBe("recently_attempted");
  });

  it("recognizes a live running claim and releases a stale one", async () => {
    const live = new JobStore(dbWithRows([
      { status: "running", error_code: null, running_live: true, cache_live: false },
    ]));
    const stale = new JobStore(dbWithRows([
      { status: "running", error_code: null, running_live: false, cache_live: false },
    ]));
    await expect(live.guard("115908")).resolves.toBe("in_progress");
    await expect(stale.guard("115908")).resolves.toBe("ready");
  });

  it("fences completion and failure updates to running claims", async () => {
    const seam = recordingCatalogPrisma();
    const store = new JobStore(seam.query);

    await store.markDone("115908");
    await store.markFailed("115908", { errorCode: "ingest_error", ttlSeconds: 3600 });

    expect(seam.statements()).toBe(2);
  });

  it("stamps the heartbeat on a claim and clears it on a park", async () => {
    const claimed = recordingCatalogPrisma([{ work_id: "w" }]);
    await new JobStore(claimed.query).acquire("w");
    // A claim moves started_at to the database's own clock.
    expect(JSON.stringify(claimed.plans()[0]?.ast)).toContain("now()");

    // A park creates a row with started_at cleared, never stamped: a pending
    // work must not read as in flight to the staleness sweep.
    const parked = recordingCatalogPrisma([], [{ work_id: "w" }]);
    await new JobStore(parked.query).ensurePending("w");
    const insert = parked.plans()[1]?.ast as { rows: readonly Record<string, { value?: unknown }>[] };
    expect(insert.rows[0]?.started_at?.value).toBeNull();
  });
});
