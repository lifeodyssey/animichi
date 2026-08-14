/**
 * Staging snapshot import pipeline (issue #1016, AC3/AC4).
 *
 * importSnapshot reads the current production snapshot through a read-only
 * SnapshotSource, rebuilds the candidate dataset, VALIDATES it — schema
 * compatibility, object hashes, row counts, provenance, and source run — and
 * only then activates it. An invalid import performs zero activation (AC4); a
 * valid import atomically switches staging's active Catalog in one PostgreSQL
 * transaction via the injected ImportActivate port (AC4). The candidate is
 * held entirely separate from the live tables until validation passes, so a
 * rejected import never touches staging's published Catalog.
 */
import { COMPATIBILITY, MANIFEST_SCHEMA_VERSION, type SnapshotManifest } from "../publish/manifest";
import { arrayBufferToText, textToArrayBuffer } from "../publish/bytes";

import type { CatalogDb } from "../db/client";
import type { SnapshotSource } from "./snapshot-source";
import { neonImportActivation, type ImportActivation } from "./switch";

/** Kinds of row-bundles a snapshot carries (mirrors candidate-export kinds). */
export type ImportKind = "works" | "points" | "aliases" | "series" | "provenance" | "media";

/** One imported object: parsed rows plus the manifest metadata to verify. */
export interface ImportObject {
  kind: ImportKind;
  key: string;
  hash: string;
  sizeBytes: number;
  rows: readonly unknown[];
}

/** The validated candidate dataset built from a snapshot before activation. */
export interface ImportCandidate {
  snapshotId: string;
  sourceRunId: string;
  createdAt: string;
  objects: readonly ImportObject[];
}

/** The outcome of an import attempt. */
export type ImportResult =
  | { status: "imported"; snapshotId: string }
  | { status: "invalid"; reason: string };

/** Validation seam; injected so a forced failure is worker-testable (AC3). */
export type ImportValidate = (
  candidate: ImportCandidate,
  manifest: SnapshotManifest,
) => Promise<{ valid: boolean; reason?: string }>;

/** Load + validate + atomically activate the current production snapshot. */
export async function importSnapshot(
  source: SnapshotSource,
  db: CatalogDb,
  validate: ImportValidate = validateImport,
  activate: ImportActivation = neonImportActivation,
): Promise<ImportResult> {
  const manifest = await source.currentManifest();
  if (manifest === null) return { status: "invalid", reason: "no snapshot to import" };
  const objects = await loadObjects(source, manifest);
  if (objects === null) return { status: "invalid", reason: "snapshot objects unavailable" };
  const candidate = {
    snapshotId: manifest.snapshotId,
    sourceRunId: manifest.sourceRunId,
    createdAt: manifest.createdAt,
    objects,
  };
  if (!(await validate(candidate, manifest)).valid) {
    return { status: "invalid", reason: "import validation failed" };
  }
  await activate.switchCatalog(db, candidate);
  return { status: "imported", snapshotId: candidate.snapshotId };
}

/** Read every object listed in the manifest; null when any object is missing. */
async function loadObjects(
  source: SnapshotSource,
  manifest: SnapshotManifest,
): Promise<readonly ImportObject[] | null> {
  const loaded: ImportObject[] = [];
  for (const meta of manifest.objects) {
    const entry = await source.readObject(meta.key);
    if (entry === null) return null;
    loaded.push({
      kind: meta.kind as ImportKind,
      key: meta.key,
      hash: meta.hash,
      sizeBytes: meta.sizeBytes,
      rows: parseRows(entry.body),
    });
  }
  return loaded;
}

/** Parse an object body (a JSON array of rows); non-array fails closed as empty. */
function parseRows(body: ArrayBuffer): readonly unknown[] {
  const value = JSON.parse(arrayBufferToText(body)) as unknown;
  return Array.isArray(value) ? value : [];
}

/** The default validation over candidate + manifest (AC3). */
export async function validateImport(
  candidate: ImportCandidate,
  manifest: SnapshotManifest,
): Promise<{ valid: boolean; reason?: string }> {
  const verdict = firstInvalid([
    () => Promise.resolve(checkSchemaCompatibility(manifest)),
    () => Promise.resolve(checkKinds(candidate)),
    () => checkHashes(candidate),
    () => Promise.resolve(checkCounts(candidate, manifest)),
    () => Promise.resolve(checkProvenance(candidate, manifest)),
  ]);
  const result = await verdict;
  return result ?? { valid: true };
}

/** Await each check in order and return the first rejection, else null. */
async function firstInvalid(
  checks: readonly (() => Promise<{ valid: boolean; reason?: string }>)[],
): Promise<{ valid: boolean; reason?: string } | null> {
  for (const check of checks) {
    const verdict = await check();
    if (!verdict.valid) return verdict;
  }
  return null;
}

/** The manifest schema/compat range must be readable by this Worker (AC3). */
function checkSchemaCompatibility(manifest: SnapshotManifest): { valid: boolean; reason?: string } {
  const min = manifest.compatibility.min;
  const max = manifest.compatibility.max;
  if (min !== COMPATIBILITY.min || max !== COMPATIBILITY.max) {
    return { valid: false, reason: "unsupported snapshot schema compatibility" };
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    return { valid: false, reason: "unsupported snapshot schema version" };
  }
  return { valid: true };
}

/** The snapshot kinds that map to public catalog tables (nothing private). */
const IMPORT_KINDS: readonly ImportKind[] = [
  "works", "points", "aliases", "series", "provenance", "media",
];

/** Every object kind must be a known public catalog snapshot kind (AC1/AC3). */
function checkKinds(candidate: ImportCandidate): { valid: boolean; reason?: string } {
  for (const object of candidate.objects) {
    if (!IMPORT_KINDS.includes(object.kind)) {
      return { valid: false, reason: "imported non-public table: " + object.kind };
    }
  }
  return { valid: true };
}

/** Re-hash every object body and compare against the manifest hash/size (AC3). */
async function checkHashes(candidate: ImportCandidate): Promise<{ valid: boolean; reason?: string }> {
  for (const object of candidate.objects) {
    const body = jsonRowsToBody(object.rows);
    const hash = await sha256Hex(body);
    if (hash !== object.hash || body.byteLength !== object.sizeBytes) {
      return { valid: false, reason: "snapshot hash mismatch: " + object.key };
    }
  }
  return { valid: true };
}

/** Row counts per object must match the manifest's recorded counts (AC3). */
function checkCounts(
  candidate: ImportCandidate,
  manifest: SnapshotManifest,
): { valid: boolean; reason?: string } {
  const counts = manifest.counts;
  for (const object of candidate.objects) {
    const expected = counts[object.kind as keyof typeof counts];
    if (expected !== object.rows.length) {
      return { valid: false, reason: "snapshot count mismatch: " + object.kind };
    }
  }
  return { valid: true };
}

/** Provenance: the snapshot carries a real source run id + provenance rows (AC3). */
function checkProvenance(
  candidate: ImportCandidate,
  manifest: SnapshotManifest,
): { valid: boolean; reason?: string } {
  if (!isSourceRunId(manifest.sourceRunId)) {
    return { valid: false, reason: "snapshot missing a valid source run" };
  }
  const provenance = candidate.objects.find((object) => object.kind === "provenance");
  if (provenance === undefined || provenance.rows.length === 0) {
    return { valid: false, reason: "snapshot carries no provenance" };
  }
  return { valid: true };
}

/** A valid source run id is produced only by a complete production run (#1006/#1012). */
function isSourceRunId(value: string): boolean {
  return /^daily-\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Serialize parsed rows back to the exact JSON bytes needed for hash verification. */
function jsonRowsToBody(rows: readonly unknown[]): ArrayBuffer {
  return textToArrayBuffer(JSON.stringify(rows));
}

/** SHA-256 hex digest of the given bytes (must equal the manifest hash). */
async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
