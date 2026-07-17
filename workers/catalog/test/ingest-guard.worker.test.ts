import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { JobStore } from "../src/ingest/jobs";

function sqlText(value: unknown): string {
  if (value === null || typeof value !== "object") return "";
  if ("value" in value && Array.isArray(value.value)) return value.value.join("");
  if (!("queryChunks" in value) || !Array.isArray(value.queryChunks)) return "";
  return value.queryChunks.map(sqlText).join("");
}

function dbWithRows(rows: object[]): CatalogDb {
  const execute = (_query: SQL) => Promise.resolve({ rows });
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
    const queries: string[] = [];
    const execute = (query: SQL) => {
      queries.push(sqlText(query));
      return Promise.resolve({ rows: [] });
    };
    const store = new JobStore({ execute } as unknown as CatalogDb);

    await store.markDone("115908");
    await store.markFailed("115908", { errorCode: "ingest_error", ttlSeconds: 3600 });

    expect(queries).toHaveLength(2);
    expect(queries.every((query) => query.includes("AND status = 'running'"))).toBe(true);
  });
});
