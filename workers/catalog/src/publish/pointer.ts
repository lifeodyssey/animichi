/**
 * The atomic current/previous snapshot pointer (issue #1012, AC3/AC5).
 *
 * A published snapshot is activated by replacing a single small R2 object
 * (`snapshots/pointer.json`) in one PUT. Because R2 object writes are atomic
 * per key, a reader always observes either the whole previous pointer or the
 * whole new pointer — never a partial mix. Validation failure writes no pointer,
 * so the current snapshot is left unchanged (AC3). Rollback is a fresh atomic
 * pointer write that swaps current and previous (AC5).
 */
import type { ObjectStore } from "./object-store";
import { arrayBufferToText, textToArrayBuffer } from "./bytes";

/** The stable R2 key hosting the atomic pointer object. */
export const POINTER_KEY = "snapshots/pointer.json";

/** The parsed pointer: which snapshot is current and which is its predecessor. */
export interface SnapshotPointer {
  current: string | null;
  previous: string | null;
}

function emptyPointer(): SnapshotPointer {
  return { current: null, previous: null };
}

/** Read and parse the pointer object; an absent pointer means no snapshot yet. */
export async function readPointer(store: ObjectStore): Promise<SnapshotPointer> {
  const entry = await store.get(POINTER_KEY);
  if (entry === null) return emptyPointer();
  return parsePointer(arrayBufferToText(entry.body));
}

/** Atomically write the pointer object (current + previous in one PUT). */
export async function writePointer(store: ObjectStore, pointer: SnapshotPointer): Promise<void> {
  await store.put(POINTER_KEY, { body: textToArrayBuffer(JSON.stringify(pointer)), contentType: "application/json" });
}

/** Parse a pointer object's JSON into the typed pointer. */
export function parsePointer(json: string): SnapshotPointer {
  const value = JSON.parse(json) as { current?: unknown; previous?: unknown };
  return {
    current: nullableString(value.current),
    previous: nullableString(value.previous),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A snapshot id that is immutable once published; derived from the run id. */
export function snapshotIdFor(runId: string): string {
  return "snap-" + runId;
}
