/**
 * Snapshot GC worker tests (issue #1012, AC4 support).
 *
 * gcSnapshots keeps the N (current) and N-1 (previous) snapshot prefixes plus
 * the live pointer, and cannot delete an object reachable from either manifest.
 * Staged-but-never-activated candidates are swept (AC6's no-leak guarantee).
 */
import { describe, expect, it } from "vitest";
import { gcSnapshots } from "../src/publish/snapshot-gc";
import { writePointer } from "../src/publish/pointer";
import { textToArrayBuffer } from "../src/publish/bytes";
import { inMemoryObjectStore } from "./fakes/in-memory-object-store";

describe("gcSnapshots N and N-1 retention (AC4 support)", () => {
  it("retains current + previous snapshots and the pointer, deleting older snapshots", async () => {
    const { store, keys } = inMemoryObjectStore();
    await Promise.all([
      store.put("snapshots/snap-a/data/works.json", { body: textToArrayBuffer("{}") }),
      store.put("snapshots/snap-a/manifest.json", { body: textToArrayBuffer("{}") }),
      store.put("snapshots/snap-b/data/points.json", { body: textToArrayBuffer("[]") }),
      store.put("snapshots/snap-c/data/aliases.json", { body: textToArrayBuffer("[]") }),
      store.put("snapshots/pointer.json", { body: textToArrayBuffer("{}") }),
    ]);
    await writePointer(store, { current: "snap-b", previous: "snap-a" });

    const result = await gcSnapshots(store, 2);

    expect(result.deleted).toBe(1);
    expect(keys()).toEqual([
      "snapshots/snap-a/data/works.json", "snapshots/snap-a/manifest.json",
      "snapshots/snap-b/data/points.json", "snapshots/pointer.json",
    ].sort());
    expect(keys()).toContain("snapshots/pointer.json");
  });

  it("never deletes an object reachable from the current manifest", async () => {
    const { store, keys } = inMemoryObjectStore();
    await store.put("snapshots/snap-a/data/works.json", { body: textToArrayBuffer("{}") });
    await writePointer(store, { current: "snap-a", previous: null });

    const result = await gcSnapshots(store, 2);

    expect(result.deleted).toBe(0);
    expect(keys()).toEqual(["snapshots/snap-a/data/works.json", "snapshots/pointer.json"].sort());
  });

  it("rejects a retention window below N and N-1", async () => {
    const { store } = inMemoryObjectStore();
    await expect(gcSnapshots(store, 1)).rejects.toThrow(/keep must be >= 2/);
  });
});
