/**
 * Immutable-snapshot public reader + guarded rollback HTTP surface (issue #1012
 * AC5) — api-typed test over the worker boundary (app.request).
 *
 * Seeds a real R2-backed snapshot pair through r2ObjectStore + publishSnapshot,
 * then exercises GET /catalog/snapshot (manifest metadata only) and the guarded
 * POST /catalog/snapshot/rollback.
 */
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import type { Env } from "../src/index";
import { r2ObjectStore } from "../src/publish/object-store";
import { publishSnapshot } from "../src/publish/snapshot";
import { fakeCatalogDb } from "./fakes/fake-catalog-db";

/** A minimal in-memory R2Bucket matching the operations r2ObjectStore uses. */
function fakeBucket(): R2Bucket {
  const blobs = new Map<string, ArrayBuffer>();
  const bucket = {
    put: (key: string, value: ArrayBuffer) => {
      blobs.set(key, value);
      return Promise.resolve({ key, etag: "x", size: value.byteLength, httpMetadata: null });
    },
    get: (key: string) => {
      const body = blobs.get(key);
      if (body === undefined) return Promise.resolve(null);
      return Promise.resolve({ key, body, size: body.byteLength, arrayBuffer: () => Promise.resolve(body), httpMetadata: null });
    },
    list: (opts: { prefix?: string } = {}) => {
      const keys = [...blobs.keys()].filter((k) => k.startsWith(opts.prefix ?? "")).sort();
      return Promise.resolve({ objects: keys.map((key) => ({ key, size: blobs.get(key)?.byteLength ?? 0 })), truncated: false });
    },
    delete: (key: string) => {
      blobs.delete(key);
      return Promise.resolve();
    },
  };
  return bucket as unknown as R2Bucket;
}

async function seed(bucket: R2Bucket): Promise<void> {
  const db = fakeCatalogDb({ bangumi: [{ id: "w1", title: "Lucky Star" }] });
  const store = r2ObjectStore(bucket);
  await publishSnapshot({ db, store }, { sourceRunId: "daily-1", createdAt: "2026-08-14T00:00:00Z" });
  await publishSnapshot({ db, store }, { sourceRunId: "daily-2", createdAt: "2026-08-15T00:00:00Z" });
}

function envOf(bucket: R2Bucket, token?: string): Env {
  return { ENVIRONMENT: "test", SNAPSHOT_BUCKET: bucket, SNAPSHOT_ADMIN_TOKEN: token };
}

describe("GET /catalog/snapshot (AC5)", () => {
  it("returns the current snapshot manifest metadata", async () => {
    const bucket = fakeBucket();
    await seed(bucket);
    const res = await app.request("/catalog/snapshot", {}, envOf(bucket));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      snapshotId: string; sourceRunId: string; createdAt: string; counts: Record<string, number>; compatibility: { min: string; max: string };
    };
    expect(body.snapshotId).toBe("snap-daily-2");
    expect(body.sourceRunId).toBe("daily-2");
    expect(body.createdAt).toBe("2026-08-15T00:00:00Z");
    expect(body.counts.works).toBe(1);
    expect(body.compatibility).toEqual({ min: "1", max: "1" });
  });

  it("404s before any snapshot publishes", async () => {
    const res = await app.request("/catalog/snapshot", {}, envOf(fakeBucket()));
    expect(res.status).toBe(404);
  });

  it("503s when no snapshot bucket is bound", async () => {
    const res = await app.request("/catalog/snapshot", {}, { ENVIRONMENT: "test" });
    expect(res.status).toBe(503);
  });
});

describe("POST /catalog/snapshot/rollback (AC5)", () => {
  it("rolls back to the previous snapshot with the correct bearer token", async () => {
    const bucket = fakeBucket();
    await seed(bucket);
    const res = await app.request(
      "/catalog/snapshot/rollback",
      { method: "POST", headers: { authorization: "Bearer ops-token" } },
      envOf(bucket, "ops-token"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { snapshotId: string };
    expect(body.snapshotId).toBe("snap-daily-1");
  });

  it("rejects a wrong bearer token with 401", async () => {
    const bucket = fakeBucket();
    await seed(bucket);
    const res = await app.request(
      "/catalog/snapshot/rollback",
      { method: "POST", headers: { authorization: "Bearer wrong" } },
      envOf(bucket, "ops-token"),
    );
    expect(res.status).toBe(401);
  });

  it("is disabled (503) when the admin token is not configured", async () => {
    const bucket = fakeBucket();
    await seed(bucket);
    const res = await app.request(
      "/catalog/snapshot/rollback",
      { method: "POST", headers: { authorization: "Bearer anything" } },
      envOf(bucket),
    );
    expect(res.status).toBe(503);
  });
});
