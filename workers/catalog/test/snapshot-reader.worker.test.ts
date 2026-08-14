/**
 * Snapshot reader API tests (issue #1012, AC5 - api).
 *
 * The public reader surface (readCurrentSnapshot / rollbackToPrevious) returns
 * only a complete current manifest and supports a deliberate rollback to the
 * previous snapshot, never exposing partial data. Driven through fakes in the
 * worker pool so the reader contract is deterministic and runnable locally.
 */
import { describe, expect, it } from "vitest";
import { publishSnapshot } from "../src/publish/snapshot";
import { readCurrentSnapshot, rollbackToPrevious } from "../src/publish/snapshot";
import { fakeCatalogDb } from "./fakes/fake-catalog-db";
import { inMemoryObjectStore } from "./fakes/in-memory-object-store";

async function storeWithTwoSnapshots() {
  const { store } = inMemoryObjectStore();
  const db = fakeCatalogDb({ bangumi: [{ id: "w1", title: "Lucky Star" }] });
  await publishSnapshot({ db, store }, { sourceRunId: "daily-1", createdAt: "2026-08-14T00:00:00Z" });
  await publishSnapshot({ db, store }, { sourceRunId: "daily-2", createdAt: "2026-08-15T00:00:00Z" });
  return { store, db };
}

describe("readCurrentSnapshot (AC5)", () => {
  it("returns null before any snapshot publishes", async () => {
    const { store } = inMemoryObjectStore();
    expect(await readCurrentSnapshot({ db: fakeCatalogDb({}), store })).toBeNull();
  });

  it("observes only the complete current snapshot, never partial data", async () => {
    const { store, db } = await storeWithTwoSnapshots();
    const current = await readCurrentSnapshot({ db, store });
    expect(current?.snapshotId).toBe("snap-daily-2");
    expect(current?.sourceRunId).toBe("daily-2");
    expect(current?.objects.length).toBe(6);
    expect(current?.objects.every((object) => /^[0-9a-f]{64}$/.test(object.hash))).toBe(true);
  });

  it("rolls back to the previous snapshot and swaps the retained pair", async () => {
    const { store, db } = await storeWithTwoSnapshots();
    const rolledBack = await rollbackToPrevious({ db, store });
    expect(rolledBack?.snapshotId).toBe("snap-daily-1");
    const nowCurrent = await readCurrentSnapshot({ db, store });
    expect(nowCurrent?.snapshotId).toBe("snap-daily-1");
    const again = await readCurrentSnapshot({ db, store });
    expect(again?.snapshotId).toBe("snap-daily-1");
  });
});
