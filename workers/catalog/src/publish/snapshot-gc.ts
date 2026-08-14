/**
 * Snapshot object garbage collection (issue #1012, AC4).
 *
 * Keeps the two pointer-referenced snapshots — the active one (N) and its
 * predecessor (N-1) — and deletes every other key under the snapshots
 * namespace. The live pointer object is always retained, and an object that is
 * reachable from either manifest (every key under a retained snapshot prefix)
 * is never deleted. Candidate/abandoned prefixes (staged but never activated)
 * are swept, which is the AC6 no-leak guarantee for failed publishes.
 */
import type { ObjectStore } from "./object-store";
import { POINTER_KEY, readPointer } from "./pointer";

/** The result of a GC pass over snapshot objects. */
export interface GcResult {
  deleted: number;
  retained: readonly string[];
}

/** Keep the live pointer plus every key under the N and N-1 snapshot prefixes. */
export async function gcSnapshots(store: ObjectStore, keep: number): Promise<GcResult> {
  if (keep < 2) throw new Error("keep must be >= 2 (N and N-1)");
  const pointer = await readPointer(store);
  const retainedIds = retainedIdsOf(pointer.current, pointer.previous);
  const keys = await store.list("snapshots/");
  const retained = new Set(keys.filter((key) => isRetainedKey(key, retainedIds)));
  let deleted = 0;
  for (const key of keys) {
    if (retained.has(key)) continue;
    await store.delete(key);
    deleted += 1;
  }
  return { deleted, retained: retainedIds };
}

/** The distinct retained snapshot ids: current (N) and previous (N-1). */
function retainedIdsOf(current: string | null, previous: string | null): readonly string[] {
  return [current, previous].filter(isNonEmpty);
}

/** A key is retained when it is the pointer or lives under a retained prefix. */
function isRetainedKey(key: string, retainedIds: readonly string[]): boolean {
  if (key === POINTER_KEY) return true;
  return retainedIds.some((id) => key.startsWith("snapshots/" + id + "/"));
}

function isNonEmpty(value: string | null): value is string {
  return value !== null && value.length > 0;
}
