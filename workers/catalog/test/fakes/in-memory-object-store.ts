/**
 * An in-memory ObjectStore fake for the snapshot layer tests (issue #1012).
 *
 * Mirrors the narrow put/get/list/delete surface so reachability GC, candidate
 * cleanup, and pointer atomicity are verifiable without a live R2 bucket.
 */
import type { ObjectStore } from "../../src/publish/object-store";

/** Create an in-memory object store over a Map of key -> ArrayBuffer, returning helpers to inspect stored keys. */
export function inMemoryObjectStore(): {
  store: ObjectStore;
  keys: () => string[];
  size: (key: string) => number;
} {
  const blobs = new Map<string, ArrayBuffer>();
  const store: ObjectStore = {
    put: (key, entry) => {
      blobs.set(key, entry.body);
      return Promise.resolve();
    },
    get: (key) => {
      const body = blobs.get(key);
      return Promise.resolve(body === undefined ? null : { body });
    },
    list: (prefix) => Promise.resolve([...blobs.keys()].filter((key) => key.startsWith(prefix)).sort((a, b) => a.localeCompare(b))),
    delete: (key) => {
      blobs.delete(key);
      return Promise.resolve();
    },
  };
  return {
    store,
    keys: () => [...blobs.keys()].sort((a, b) => a.localeCompare(b)),
    size: (key) => blobs.get(key)?.byteLength ?? 0,
  };
}

/** Decode a stored object's bytes to text (for assertions). */
export function entryText(body: ArrayBuffer): string {
  return new TextDecoder().decode(body);
}
