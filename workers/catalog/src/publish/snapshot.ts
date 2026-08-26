/**
 * Immutable catalog snapshot orchestration (issue #1012, AC3/AC5/AC6).
 *
 * publishSnapshot runs the export -> stage -> validate -> activate pipeline over
 * the CatalogDb seam for reads and the ObjectStore seam for durable objects.
 * Activation is a single atomic pointer write (see pointer.ts), so validation
 * success moves previous->old and activates the new run; validation failure
 * deletes NOTHING (no objects are staged until activation), and a staging
 * failure removes only the keys this attempt staged — never objects belonging
 * to a snapshot activated by an earlier attempt.
 */
import type { CatalogDb } from "../db/client";
import { exportCandidate, type CandidateExport, EXPORTED_TABLES } from "./candidate-export";
import { buildManifest, manifestJson, type SnapshotManifest } from "./manifest";
import { arrayBufferToText, textToArrayBuffer } from "./bytes";
import type { ObjectStore } from "./object-store";
import { POINTER_KEY, readPointer, snapshotIdFor, writePointer } from "./pointer";

/** Collaborators for publishing and reading snapshots. */
export interface SnapshotDeps {
  db: CatalogDb;
  store: ObjectStore;
}

/** Validation port; injected so a forced failure is testable (AC3). */
export type ValidatePort = (export_: CandidateExport) => Promise<{ valid: boolean; reason?: string }>;

/** Inputs for publishing a snapshot from one source run. */
export interface PublishInput {
  sourceRunId: string;
  createdAt: string;
}

/** The outcome of a publish attempt. */
export type PublishResult =
  | { status: "published"; snapshot: SnapshotManifest }
  | { status: "invalid"; reason: string };

function snapshotPrefix(snapshotId: string): string {
  return "snapshots/" + snapshotId;
}

function dataPrefix(snapshotId: string): string {
  return snapshotPrefix(snapshotId) + "/data";
}

function manifestKey(snapshotId: string): string {
  return snapshotPrefix(snapshotId) + "/manifest.json";
}

/** Publish an immutable snapshot: export, stage, validate, then atomically activate. */
export async function publishSnapshot(
  deps: SnapshotDeps, input: PublishInput, validate: ValidatePort = validateExport,
): Promise<PublishResult> {
  const snapshotId = snapshotIdFor(input.sourceRunId);
  const candidate = await exportCandidate(deps.db, dataPrefix(snapshotId));
  if (!(await validate(candidate)).valid) return invalid();
  return activate(deps, candidate, snapshotId, input);
}

/** Validation failure reports invalidity and deletes NOTHING (nothing is staged yet). */
function invalid(): PublishResult {
  return { status: "invalid", reason: "candidate validation failed" };
}

/** Validation passed: stage objects + manifest, then flip the atomic pointer. */
async function activate(
  deps: SnapshotDeps, candidate: CandidateExport, snapshotId: string, input: PublishInput,
): Promise<PublishResult> {
  const manifest = buildManifest(candidate, snapshotId, input.sourceRunId, input.createdAt);
  let staged: readonly string[] = [];
  try {
    staged = await stageObjects(deps.store, candidate);
    await deps.store.put(manifestKey(snapshotId), { body: textToArrayBuffer(manifestJson(manifest)), contentType: "application/json" });
    const pointer = await readPointer(deps.store);
    await writePointer(deps.store, { current: snapshotId, previous: pointer.current });
    return { status: "published", snapshot: manifest };
  } catch (error) {
    console.error(`[snapshot] staging failed for ${snapshotId}: ${String(error).slice(0, 200)}`);
    await deleteKeys(deps.store, staged);
    return invalid();
  }
}

/** The default candidate validation: allowlist + well-formed hashes (AC1/AC2). */
export function validateExport(export_: CandidateExport): Promise<{ valid: boolean; reason?: string }> {
  for (const table of export_.exportedTables) {
    if (!(EXPORTED_TABLES as readonly string[]).includes(table)) {
      return Promise.resolve({ valid: false, reason: "exported non-public table: " + table });
    }
  }
  if (export_.objects.some((object) => object.hash.length === 0 || object.sizeBytes === 0)) {
    return Promise.resolve({ valid: false, reason: "candidate object missing hash or size" });
  }
  return Promise.resolve({ valid: true });
}

/** Stage every exported object; returns the keys THIS attempt put (AC6 cleanup scope). */
async function stageObjects(store: ObjectStore, export_: CandidateExport): Promise<readonly string[]> {
  const staged: string[] = [];
  for (const object of export_.objects) {
    await store.put(object.key, { body: object.body, contentType: "application/json" });
    staged.push(object.key);
  }
  return staged;
}

/** Delete only the exact keys a failed activation attempt staged (never prior snapshots). */
async function deleteKeys(store: ObjectStore, keys: readonly string[]): Promise<void> {
  for (const key of keys) await store.delete(key);
}

/** Read the complete current snapshot manifest, or null when none exists. */
export async function readCurrentSnapshot(deps: SnapshotDeps): Promise<SnapshotManifest | null> {
  const pointer = await readPointer(deps.store);
  if (pointer.current === null) return null;
  return readManifest(deps.store, pointer.current);
}

/** Read and parse a snapshot's immutable manifest by id. */
export async function readManifest(store: ObjectStore, snapshotId: string): Promise<SnapshotManifest | null> {
  const entry = await store.get(manifestKey(snapshotId));
  if (entry === null) return null;
  return JSON.parse(arrayBufferToText(entry.body)) as SnapshotManifest;
}

/** Deliberately roll back the public reader to the previous snapshot (AC5). Returns null when there is nothing to roll back to (no current or no previous). */
export async function rollbackToPrevious(deps: SnapshotDeps): Promise<SnapshotManifest | null> {
  const pointer = await readPointer(deps.store);
  if (pointer.current === null || pointer.previous === null) return null;
  await writePointer(deps.store, { current: pointer.previous, previous: pointer.current });
  return readManifest(deps.store, pointer.previous);
}

/** The stable snapshot-object key namespace; used by online GC scoping. */
export { POINTER_KEY };
