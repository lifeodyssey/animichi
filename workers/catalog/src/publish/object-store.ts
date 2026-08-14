/**
 * The immutable-snapshot object store seam (issue #1012, AC4/AC6).
 *
 * Immutable catalog snapshots — the exported row objects, the manifest, and the
 * atomic current/previous pointer — live in R2, the same bucket family as the
 * lazy-cached point photos (catalog-media, see ../media/img.ts). Production
 * wraps the real R2Bucket binding; tests inject an in-memory fake so the
 * purge/GC + failed-publish lifecycle is verifiable without a live bucket.
 *
 * The seam surface is deliberately narrow (put/get/list/delete under a prefix)
 * so reachability GC and candidate cleanup can be proven deterministically.
 */

/** A stored object: bytes + optional content type. */
export interface ObjectStoreEntry {
  body: ArrayBuffer;
  contentType?: string;
}

/** The narrow object-store surface the snapshot layer depends on. */
export interface ObjectStore {
  put(key: string, entry: ObjectStoreEntry): Promise<void>;
  get(key: string): Promise<ObjectStoreEntry | null>;
  /** All keys under prefix (inclusive of the prefix-bearing prefix itself). */
  list(prefix: string): Promise<readonly string[]>;
  delete(key: string): Promise<void>;
}

/** Adapter over the Cloudflare R2Bucket binding. */
export function r2ObjectStore(bucket: R2Bucket): ObjectStore {
  return {
    put: async (key, entry) => {
      await bucket.put(key, entry.body, {
        httpMetadata: entry.contentType ? { contentType: entry.contentType } : undefined,
      });
    },
    get: async (key) => {
      const object = await bucket.get(key);
      if (object === null) return null;
      return { body: await object.arrayBuffer(), contentType: object.httpMetadata?.contentType };
    },
    list: async (prefix) => {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix, cursor });
        for (const item of page.objects) keys.push(item.key);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor !== undefined);
      return keys;
    },
    delete: async (key) => {
      await bucket.delete(key);
    },
  };
}
