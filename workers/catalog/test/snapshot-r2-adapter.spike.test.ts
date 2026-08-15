/**
 * R2 adapter + online retention end-to-end spike (issue #1012, AC6).
 *
 * Closes the "R2 half": r2ObjectStore is instantiated against a REAL R2 bucket
 * (Miniflare's in-memory R2 implementation) — the same adapter the composition
 * root wires to SNAPSHOT_BUCKET — and the N/N-1 retention contract is verified
 * end to end: publish twice, add an abandoned snapshot, then gcSnapshots(keep=2)
 * retains exactly the live pointer + the N and N-1 prefixes and sweeps the rest.
 * Runs without Neon, so it also runs in the offline default.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import type { CatalogDb } from "../src/db/client";
import { r2ObjectStore, type ObjectStore } from "../src/publish/object-store";
import { publishSnapshot } from "../src/publish/snapshot";
import { gcSnapshots } from "../src/publish/snapshot-gc";
import { readPointer, POINTER_KEY } from "../src/publish/pointer";
import { fakeCatalogDb } from "./fakes/fake-catalog-db";
import { textToArrayBuffer } from "../src/publish/bytes";

let mf: Miniflare | undefined;

afterEach(async () => {
  await mf?.dispose();
  mf = undefined;
});

/** Open a real Miniflare R2 bucket and wrap it in the production adapter. */
async function openStore(): Promise<ObjectStore> {
  mf = new Miniflare({
    modules: true,
    script: "export default { async fetch() { return new Response('ok'); } }",
    r2Buckets: ["SNAPSHOT_BUCKET"],
  });
  const bucket = await mf.getR2Bucket("SNAPSHOT_BUCKET");
  return r2ObjectStore(bucket as unknown as R2Bucket);
}

async function storeKeys(store: ObjectStore): Promise<string[]> {
  return [...(await store.list(""))].sort();
}

describe("r2ObjectStore retention end-to-end (AC6/AC4)", () => {
  it("publishes N/N-1 and gcSnapshots retains the live pointer and both snapshots", async () => {
    const store = await openStore();
    const db: CatalogDb = fakeCatalogDb({ bangumi: [{ id: "w1" }] });
    await publishSnapshot({ db, store }, { sourceRunId: "daily-1", createdAt: "2026-08-14T00:00:00Z" });
    await publishSnapshot({ db, store }, { sourceRunId: "daily-2", createdAt: "2026-08-15T00:00:00Z" });
    // An abandoned snapshot that no pointer references must be swept.
    await store.put("snapshots/snap-orphan/data/works.json", { body: textToArrayBuffer("[]"), contentType: "application/json" });

    const result = await gcSnapshots(store, 2);

    expect(result.retained).toContain("snap-daily-1");
    expect(result.retained).toContain("snap-daily-2");
    const keys = await storeKeys(store);
    expect(keys).toContain(POINTER_KEY);
    expect(keys.some((k) => k.includes("snap-daily-1"))).toBe(true);
    expect(keys.some((k) => k.includes("snap-daily-2"))).toBe(true);
    expect(keys.some((k) => k.includes("snap-orphan"))).toBe(false);
    expect((await readPointer(store)).current).toBe("snap-daily-2");
  });

  it("publishes durable snapshot objects through the R2 adapter (read them back)", async () => {
    const store = await openStore();
    const db: CatalogDb = fakeCatalogDb({ aliases: [{ bangumiId: "w1", alias: "x" }] });
    const result = await publishSnapshot({ db, store }, { sourceRunId: "daily-1", createdAt: "2026-08-14T00:00:00Z" });
    expect(result.status).toBe("published");
    const entry = await store.get("snapshots/snap-daily-1/data/works.json");
    expect(entry).not.toBeNull();
  });
});
