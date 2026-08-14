/**
 * Read-side snapshot source for the staging import (issue #1016, AC2/AC3).
 *
 * The import reads the current immutable snapshot (manifest + objects) through
 * a narrow SnapshotSource port. Production publishes to R2; staging must NOT
 * hold production bucket credentials, so its SnapshotSource is an adapter over
 * the private read-only service binding (SnapshotReadEntrypoint). Both adapters
 * expose the same read-only surface — no production bucket credential, no
 * arbitrary database read, no mutation method crosses this seam.
 */
import type { SnapshotManifest } from "../publish/manifest";
import type { ObjectStoreEntry } from "../publish/object-store";
import { r2ObjectStore } from "../publish/object-store";
import { readCurrentSnapshot } from "../publish/snapshot";

/**
 * The read-only service surface production exposes to staging (spec §262 / #1016).
 * Staging calls currentManifest() + readObject() through a private service
 * binding; there is no write path and no bucket credential exchanged.
 */
export interface SnapshotReadService {
  currentManifest(): Promise<SnapshotManifest | null>;
  readObject(key: string): Promise<ObjectStoreEntry | null>;
}

/** The port the import pipeline reads through (manifest + objects). */
export type SnapshotSource = SnapshotReadService;

/** A SnapshotSource over a direct R2 binding (tests + self-contained envs). */
export function r2SnapshotSource(bucket: R2Bucket): SnapshotSource {
  const store = r2ObjectStore(bucket);
  return {
    currentManifest: () => readCurrentSnapshot({ db: NO_DB, store }),
    readObject: (key) => store.get(key),
  };
}

/** A SnapshotSource over the private production service binding (staging). */
export function serviceSnapshotSource(service: SnapshotReadService): SnapshotSource {
  return {
    currentManifest: () => service.currentManifest(),
    readObject: (key) => service.readObject(key),
  };
}

/**
 * Resolve the read-only snapshot source from a worker environment: prefer the
 * private production service binding (staging import), fall back to a local R2
 * bucket (tests/self-contained envs), else null (no import source — fail closed).
 */
export function snapshotSourceFor(env: {
  PROD_SNAPSHOT?: SnapshotReadService;
  SNAPSHOT_BUCKET?: R2Bucket;
}): SnapshotSource | null {
  if (env.PROD_SNAPSHOT !== undefined) return serviceSnapshotSource(env.PROD_SNAPSHOT);
  if (env.SNAPSHOT_BUCKET !== undefined) return r2SnapshotSource(env.SNAPSHOT_BUCKET);
  return null;
}

/** A db that must never be queried by the read-only snapshot source. */
const NO_DB = {
  execute: () => Promise.reject(new Error("snapshot reader never queries the db")),
} as unknown as import("../db/client").CatalogDb;
