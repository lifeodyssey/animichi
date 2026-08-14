import { describe, expect, it } from "vitest";
import type { CatalogDb } from "../src/db/client";
import { JobStore } from "../src/ingest/jobs";

function dbWithRows(rows: object[]): CatalogDb {
  const execute = () => Promise.resolve({ rows });
  return { execute } as unknown as CatalogDb;
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
    let writes = 0;
    const execute = () => {
      writes += 1;
      return Promise.resolve({ rows: [] });
    };
    const store = new JobStore({ execute } as unknown as CatalogDb);

    await store.markDone("115908");
    await store.markFailed("115908", { errorCode: "ingest_error", ttlSeconds: 3600 });

    expect(writes).toBe(2);
  });
});
