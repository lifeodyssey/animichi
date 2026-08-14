/**
 * Daily discovery (#1006 AC2): combine Bangumi current-season, popularity, and
 * historical inputs into one deterministic target set with bounded daily growth.
 *
 * Discovery is a pure merge over the three upstream inputs. Each candidate is a
 * bangumi id; dedup is by id (a stable string), so the merge is deterministic no
 * matter how the sources are ordered. New works (ids not already cataloged) are
 * admitted up to `newWorkCap` per run — a bound, not a source-code number — so
 * daily growth stays explicit and reviewable. Known works always pass through.
 */
export type DiscoverySource = "current_season" | "popularity" | "historical";

/** A discovered work and the source(s) that produced it. */
export interface DiscoveredWork {
  bangumiId: string;
  sources: readonly DiscoverySource[];
  /** True when the id was not already known to the catalog before this run. */
  isNew: boolean;
}

/** One upstream discovery input, in upstream relevance order. */
export interface DiscoveryInput {
  source: DiscoverySource;
  bangumiIds: readonly string[];
}

/** The merged, bounded result of a discovery pass. */
export interface DiscoveryResult {
  works: DiscoveredWork[];
  /** Raw unique ids seen across the inputs, before the new-work cap. */
  uniqueSeen: number;
  /** Unique ids that were already known (not counted against the cap). */
  knownCount: number;
  /** Unique new ids admitted against the cap. */
  newCount: number;
  /** New ids dropped because the cap was already reached. */
  cappedCount: number;
}

/**
 * Merge the discovery inputs into a deterministic target set. Inputs are merged
 * source-by-source in the caller's order; first-seen wins the primary source,
 * later sources are appended to `sources`. Known ids never count against the
 * new-work cap; unused new ids beyond the cap are reported (not silently kept).
 */
export function mergeDiscovery(
  knownIds: ReadonlySet<string>,
  inputs: readonly DiscoveryInput[],
  newWorkCap: number,
): DiscoveryResult {
  assertCap(newWorkCap);
  const acc = emptyAccumulator(knownIds, newWorkCap);
  for (const input of inputs) {
    for (const bangumiId of input.bangumiIds) {
      mergeOne(acc, input.source, bangumiId);
    }
  }
  return {
    works: acc.ordered,
    uniqueSeen: acc.uniqueSeen,
    knownCount: acc.knownCount,
    newCount: acc.newCount,
    cappedCount: acc.cappedCount,
  };
}

/** A fresh merge accumulator over the discovery inputs. */
function emptyAccumulator(knownIds: ReadonlySet<string>, newWorkCap: number): MergeAccumulator {
  return { knownIds, newWorkCap, ordered: [], freshIndices: new Map(), uniqueSeen: 0, knownCount: 0, newCount: 0, cappedCount: 0 };
}

/** Fold one input id into the accumulator (dedup, source append, bounded growth). */
function mergeOne(acc: MergeAccumulator, source: DiscoverySource, bangumiId: string): void {
  const existing = findWork(acc.ordered, acc.freshIndices, bangumiId);
  if (existing) {
    existing.sources = appendSource(existing.sources, source);
    return;
  }
  acc.uniqueSeen += 1;
  const isNew = !acc.knownIds.has(bangumiId);
  if (!allowAdmit(isNew, acc.newCount, acc.newWorkCap)) {
    acc.cappedCount += 1;
    return;
  }
  if (isNew) {
    acc.newCount += 1;
  } else {
    acc.knownCount += 1;
  }
  const work: DiscoveredWork = { bangumiId, sources: [source], isNew };
  acc.ordered.push(work);
  acc.freshIndices.set(bangumiId, acc.ordered.length - 1);
}

/** Known ids pass through; new ids are admitted only inside the daily cap. */
function allowAdmit(isNew: boolean, newCount: number, newWorkCap: number): boolean {
  return !isNew || newCount < newWorkCap;
}

/** Mutable merge state carried across the discovery inputs. */
interface MergeAccumulator {
  knownIds: ReadonlySet<string>;
  newWorkCap: number;
  ordered: DiscoveredWork[];
  freshIndices: Map<string, number>;
  uniqueSeen: number;
  knownCount: number;
  newCount: number;
  cappedCount: number;
}
/** Locate an already-merged work by id, or undefined when fresh. */
function findWork(
  ordered: readonly DiscoveredWork[],
  indices: ReadonlyMap<string, number>,
  bangumiId: string,
): DiscoveredWork | undefined {
  const index = indices.get(bangumiId);
  return index === undefined ? undefined : ordered[index];
}

/** Append a source to a work's source list, preserving order and no duplicates. */
function appendSource(sources: readonly DiscoverySource[], source: DiscoverySource): readonly DiscoverySource[] {
  const next = [...sources];
  if (!sources.includes(source)) next.push(source);
  return next;
}

function assertCap(newWorkCap: number): void {
  if (!Number.isInteger(newWorkCap) || newWorkCap < 0) {
    throw new Error("newWorkCap must be a non-negative integer");
  }
}

/** A stable, sortable run identity: a chronological date key (UTC). */
export function dailyRunKey(epochMs: number): string {
  const date = new Date(epochMs).toISOString().slice(0, 10);
  return "daily-" + date;
}
