/**
 * Snapshot activation worker tests (issue #1012, AC3/AC6 support).
 *
 * Drives publishSnapshot with a fake db (empty public rows → a minimal candidate)
 * and an in-memory object store. Proves the AC3 contract: a validation failure
 * leaves the current pointer untouched AND deletes the staged candidate objects
 * (AC6 — a failed publish leaks nothing); a valid candidate atomically moves
 * previous to old and activates the new run. The authoritative integration
 * proofs run in the spike suite.
 */
import { describe, expect, it } from "vitest";
import { publishSnapshot, type PublishInput, type ValidatePort } from "../src/publish/snapshot";
import { POINTER_KEY, readPointer } from "../src/publish/pointer";
import { fakeCatalogDb } from "./fakes/fake-catalog-db";
import { inMemoryObjectStore } from "./fakes/in-memory-object-store";

const INPUT: PublishInput = { sourceRunId: "daily-1", createdAt: "2026-08-14T00:00:00Z" };

function reject(): ValidatePort {
  return () => Promise.resolve({ valid: false, reason: "forced failure" });
}

describe("publishSnapshot atomic activation (AC3 support)", () => {
  it("a validation failure leaves the current pointer unchanged and deletes staged candidates", async () => {
    const { store, keys } = inMemoryObjectStore();
    const db = fakeCatalogDb({});
    await publishSnapshot({ db, store }, INPUT, reject());
    expect(await readPointer(store)).toEqual({ current: null, previous: null });
    expect(keys().some((key) => key === POINTER_KEY)).toBe(false);
    expect(keys().filter((key) => key.startsWith("snapshots/")).length).toBe(0);
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
