/**
 * Immutable snapshot manifest (issue #1012, AC2).
 *
 * A manifest is the immutable description of one published catalog snapshot. It
 * records the schema version, the source run id that produced it, a per-object
 * SHA-256 hash and size for every exported object, the row/object counts, the
 * injected creation time, and a compatibility range that preserves the
 * "N and N-1" read contract across rolling deployments.
 *
 * buildManifest is a pure function over an export + pointer metadata, so it is
 * deterministically unit-testable with fakes in the worker pool.
 */
import type { CandidateExport } from "./candidate-export";
import type { ExportCounts } from "./candidate-export";

/** The current manifest schema; older readers honour N-1 compatibility. */
export const MANIFEST_SCHEMA_VERSION = "1";

/** The compatibility range supported by this manifest format. */
export const COMPATIBILITY = { min: "1", max: "1" } as const;

/** Metadata a manifest carries for one exported object. */
export interface ManifestObject {
  kind: string;
  key: string;
  hash: string;
  sizeBytes: number;
}

/** A validated, immutable snapshot manifest. */
export interface SnapshotManifest {
  schemaVersion: string;
  snapshotId: string;
  sourceRunId: string;
  createdAt: string;
  objects: readonly ManifestObject[];
  counts: ExportCounts;
  compatibility: Readonly<{ min: string; max: string }>;
}

/** Build the manifest for a candidate export under a snapshot id. */
export function buildManifest(
  export_: CandidateExport,
  snapshotId: string,
  sourceRunId: string,
  createdAt: string,
): SnapshotManifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    snapshotId,
    sourceRunId,
    createdAt,
    objects: export_.objects.map(toManifestObject),
    counts: export_.counts,
    compatibility: COMPATIBILITY,
  };
}

function toManifestObject(object: { kind: string; key: string; hash: string; sizeBytes: number }): ManifestObject {
  return { kind: object.kind, key: object.key, hash: object.hash, sizeBytes: object.sizeBytes };
}

/** A JSON-compatible snapshot of the manifest (the stored artifact). */
export function manifestJson(manifest: SnapshotManifest): string {
  return JSON.stringify(manifest);
}
