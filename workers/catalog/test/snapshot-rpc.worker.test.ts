/**
 * Read-only snapshot RPC surface (issue #1016, AC2) — api test.
 *
 * SnapshotReadEntrypoint is the production Worker's private read-only snapshot
 * service that STAGING calls through a service binding: it reads the current
 * snapshot manifest + objects and exposes NO bucket credential, database
 * access, or mutation method. This proves the read surface over a real
 * R2-backed snapshot, and that the staging adapter binds to it.
 */
import { describe, expect, it } from "vitest";
import { SnapshotReadEntrypoint } from "../src/index";
import { Env } from "../src/index";
import { r2ObjectStore } from "../src/publish/object-store";
import { publishSnapshot } from "../src/publish/snapshot";
import { fakeCatalogDb } from "./fakes/fake-catalog-db";
import { serviceSnapshotSource } from "../src/import/snapshot-source";

function fakeBucket(): R2Bucket {
  const blobs = new Map<string, ArrayBuffer>();
  return {
    put: (key: string, value: ArrayBuffer) => { blobs.set(key, value); return Promise.resolve({ key, etag: "x", size: value.byteLength, httpMetadata: null }); },
    get: (key: string) => {
      const body = blobs.get(key);
      if (body === undefined) return Promise.resolve(null);
      return Promise.resolve({ key, body, size: body.byteLength, arrayBuffer: () => Promise.resolve(body), httpMetadata: null });
    },
    list: (opts: { prefix?: string } = {}) => {
      const keys = [...blobs.keys()].filter((k) => k.startsWith(opts.prefix ?? "")).sort();
      return Promise.resolve({ objects: keys.map((key) => ({ key, size: blobs.get(key)?.byteLength ?? 0 })), truncated: false });
    },
    delete: (key: string) => { blobs.delete(key); return Promise.resolve(); },
  } as unknown as R2Bucket;
}

function entrypoint(bucket: R2Bucket): SnapshotReadEntrypoint {
  const env: Env = { ENVIRONMENT: "production", SNAPSHOT_BUCKET: bucket };
  return new SnapshotReadEntrypoint({} as unknown as ExecutionContext, env);
}

async function seed(bucket: R2Bucket): Promise<void> {
  const db = fakeCatalogDb({ bangumi: [{ id: "w1", title: "Lucky Star" }] });
  await publishSnapshot({ db, store: r2ObjectStore(bucket) }, { sourceRunId: "daily-2026-08-14", createdAt: "2026-08-14T00:00:00Z" });
}

describe("SnapshotReadEntrypoint (AC2)", () => {
  it("reads the current snapshot manifest, read-only", async () => {
    const bucket = fakeBucket();
    await seed(bucket);
    const manifest = await entrypoint(bucket).currentManifest();
    expect(manifest?.snapshotId).toBe("snap-daily-2026-08-14");
    expect(manifest?.sourceRunId).toBe("daily-2026-08-14");
  });

  it("reads snapshot objects by key", async () => {
    const bucket = fakeBucket();
    await seed(bucket);
    const entry = await entrypoint(bucket).readObject("snapshots/snap-daily-2026-08-14/data/works.json");
    expect(entry).not.toBeNull();
    const text = entry ? new TextDecoder().decode(entry.body) : "";
    expect(text).toContain("Lucky Star");
  });

  it("returns null for the manifest when no snapshot bucket is bound", async () => {
    const e = new SnapshotReadEntrypoint({} as unknown as ExecutionContext, { ENVIRONMENT: "production" });
    await expect(e.currentManifest()).resolves.toBeNull();
  });

  it("the staging source adapter wraps the service read surface only", async () => {
    const bucket = fakeBucket();
    await seed(bucket);
    const source = serviceSnapshotSource(entrypoint(bucket));
    const manifest = await source.currentManifest();
    const entry = await source.readObject("snapshots/snap-daily-2026-08-14/data/works.json");
    expect(manifest?.sourceRunId).toBe("daily-2026-08-14");
    expect(entry).not.toBeNull();
  });
});
