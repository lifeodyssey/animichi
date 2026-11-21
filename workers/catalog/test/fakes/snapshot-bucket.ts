/**
 * The snapshot bucket the HTTP snapshot surface reads (`SNAPSHOT_BUCKET`), in
 * memory, for the worker tests that drive `GET /catalog/snapshot` and
 * `POST /catalog/snapshot/rollback` through the real app.
 */
import { r2ObjectStore } from "../../src/publish/object-store";
import { publishSnapshot } from "../../src/publish/snapshot";
import { fakeTableRows } from "./fake-catalog-prisma";

/** An in-memory R2Bucket with the four operations `r2ObjectStore` uses. */
export function makeSnapshotBucket(): R2Bucket {
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

/** Publish `daily-1` then `daily-2` into `bucket`, so `snap-daily-2` is current and `snap-daily-1` is the previous one. */
export async function publishTwoSnapshots(bucket: R2Bucket): Promise<void> {
  const query = fakeTableRows({ bangumi: [{ id: "w1", title: "Lucky Star" }] });
  const store = r2ObjectStore(bucket);
  await publishSnapshot({ query, store }, { sourceRunId: "daily-1", createdAt: "2026-08-14T00:00:00Z" });
  await publishSnapshot({ query, store }, { sourceRunId: "daily-2", createdAt: "2026-08-15T00:00:00Z" });
}
