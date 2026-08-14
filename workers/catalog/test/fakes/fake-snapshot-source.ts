/**
 * An in-memory SnapshotSource fake for the import + schedule tests.
 * Seed manifests/objects; readObject returns what was stored.
 */
import type { SnapshotSource } from "../../src/import/snapshot-source";
import type { SnapshotManifest } from "../../src/publish/manifest";
import type { ObjectStoreEntry } from "../../src/publish/object-store";
import { jsonToArrayBuffer } from "../../src/publish/bytes";

/** Create an empty in-memory SnapshotSource; seed via seedManifest/seedObject. */
export function fakeSnapshotSource(): {
  source: SnapshotSource;
  manifest: () => SnapshotManifest | null;
  setManifest: (m: SnapshotManifest | null) => void;
  objects: () => Map<string, ObjectStoreEntry>;
} {
  let current: SnapshotManifest | null = null;
  const blobs = new Map<string, ObjectStoreEntry>();
  const source: SnapshotSource = {
    currentManifest: () => Promise.resolve(current),
    readObject: (key) => Promise.resolve(blobs.get(key) ?? null),
  };
  return {
    source,
    manifest: () => current,
    setManifest: (m) => { current = m; },
    objects: () => blobs,
  };
}

/** A convenience JSON-entry builder for fake snapshot objects. */
export function jsonEntry(value: unknown): ObjectStoreEntry {
  return { body: jsonToArrayBuffer(value) };
}
