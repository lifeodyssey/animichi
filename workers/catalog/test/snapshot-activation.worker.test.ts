/**
 * Snapshot activation worker tests (issue #1012, AC3/AC6 support).
 *
 * Drives publishSnapshot with a fake db (empty public rows → a minimal candidate)
 * and an in-memory object store. Proves the AC3 contract: a validation failure
 * leaves the store ENTIRELY untouched (nothing is staged until activation) and
 * the pointer unchanged; a same-run-id re-publish that fails validation never
 * deletes the live snapshot's objects (issue #1012 live-snapshot-deletion). The
 * authoritative integration proofs run in the spike suite.
 */
import { describe, expect, it, vi } from "vitest";
import { publishSnapshot, type PublishInput, type ValidatePort } from "../src/publish/snapshot";
import { readPointer } from "../src/publish/pointer";
import type { ObjectStore } from "../src/publish/object-store";
import { fakeCatalogDb } from "./fakes/fake-catalog-db";
import { inMemoryObjectStore } from "./fakes/in-memory-object-store";

const INPUT: PublishInput = { sourceRunId: "daily-1", createdAt: "2026-08-14T00:00:00Z" };

function reject(): ValidatePort {
  return () => Promise.resolve({ valid: false, reason: "forced failure" });
}

describe("publishSnapshot atomic activation (AC3 support)", () => {
  it("a validation failure leaves the store untouched and the pointer unchanged", async () => {
    const { store, keys } = inMemoryObjectStore();
    const db = fakeCatalogDb({});
    await publishSnapshot({ db, store }, INPUT, reject());
    expect(await readPointer(store)).toEqual({ current: null, previous: null });
    expect(keys()).toEqual([]);
  });

  it("a same-run-id re-publish that fails validation never deletes the live snapshot", async () => {
    const { store, keys } = inMemoryObjectStore();
    const db = fakeCatalogDb({ bangumi: [{ id: "w1" }] });
    const first = await publishSnapshot({ db, store }, INPUT);
    expect(first.status).toBe("published");
    const liveDataKeys = keys().filter((key) => key.startsWith("snapshots/snap-daily-1/data/"));
    expect(liveDataKeys.length).toBeGreaterThan(0);
    await publishSnapshot({ db, store }, INPUT, reject());
    expect(await readPointer(store)).toEqual({ current: "snap-daily-1", previous: null });
    for (const key of liveDataKeys) expect(keys()).toContain(key);
  });

  it("a valid candidate atomically moves previous to old current and activates the new run", async () => {
    const { store, keys } = inMemoryObjectStore();
    const db = fakeCatalogDb({});
    const first = await publishSnapshot({ db, store }, { sourceRunId: "daily-1", createdAt: "2026-08-14T00:00:00Z" });
    expect(first.status).toBe("published");
    const beforePrevious = await readPointer(store);
    expect(beforePrevious.previous).toBeNull();
    const second = await publishSnapshot({ db, store }, { sourceRunId: "daily-2", createdAt: "2026-08-15T00:00:00Z" });
    expect(second.status).toBe("published");
    const after = await readPointer(store);
    expect(after).toEqual({ current: "snap-daily-2", previous: "snap-daily-1" });
    expect(keys()).toContain("snapshots/snap-daily-1/data/works.json");
    expect(keys()).toContain("snapshots/snap-daily-2/manifest.json");
  });
});

describe("publishSnapshot staging failure signal (failure-signal audit C7/A5)", () => {
  it("logs the real exception when staging (store.put) throws, and still returns invalid", async () => {
    const { store: base } = inMemoryObjectStore();
    const throwingStore: ObjectStore = {
      ...base,
      put: () => Promise.reject(new Error("R2 quota exceeded")),
    };
    const db = fakeCatalogDb({ bangumi: [{ id: "w1" }] });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    errorSpy.mockClear();

    const result = await publishSnapshot({ db, store: throwingStore }, INPUT);

    expect(result).toEqual({ status: "invalid", reason: "candidate validation failed" });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message] = errorSpy.mock.calls[0] as [string];
    expect(message).toContain("R2 quota exceeded");
    expect(message.toLowerCase()).toContain("stag");
    errorSpy.mockRestore();
  });
});

describe("publishSnapshot candidate object hashing (AC2 support)", () => {
  it("stores manifest objects with non-empty hashes for the active snapshot", async () => {
    const { store } = inMemoryObjectStore();
    const db = fakeCatalogDb({ bangumi: [{ id: "w1" }] });
    const result = await publishSnapshot({ db, store }, INPUT);
    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(result.snapshot.counts.works).toBe(1);
    expect(result.snapshot.objects.find((o) => o.kind === "works")?.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
