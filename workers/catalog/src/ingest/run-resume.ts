/**
 * Resuming a daily run (#1006 AC1): what an attempt inherits from the row an
 * earlier attempt of the same stable run id left. A live run is skipped, a stale
 * `running` one is reclaimed, and any other is resumed past the works it already
 * published, carrying its failure ledger forward: a retry appends to that ledger
 * and never replaces it.
 */
import type { RunFailure, RunPlan, RunSnapshot } from "./daily-run";
import type { DueWork } from "./tiers";

/** An existing run's disposition for this attempt. */
type ResumePlan =
  | { kind: "fresh" | "stale" | "resume"; published: ReadonlyMap<string, number> }
  | { kind: "skip"; existing: RunSnapshot };

/**
 * Decide how to handle an existing run row: skip an in-flight run, reclaim a
 * stale `running` run, or resume past already-published works.
 */
export function resumeOf(existing: RunSnapshot | null, plan: RunPlan): ResumePlan {
  if (existing === null || existing.status === "pending") return { kind: "fresh", published: emptyPublished() };
  if (existing.status === "running") {
    if (isStale(existing.startedAtMs, plan.epochMs, plan.policy.staleRunningMs)) return { kind: "stale", published: emptyPublished() };
    return { kind: "skip", existing };
  }
  return { kind: "resume", published: publishedOf(existing.published) };
}

/** A running run is stale once it has outlived the reclaim threshold. */
function isStale(startedAtMs: number | null, nowMs: number, staleRunningMs: number): boolean {
  if (startedAtMs === null) return true;
  return nowMs - startedAtMs > staleRunningMs;
}

/** A retry resumes by recording every work already published under this run id. */
function publishedOf(published: Record<string, number>): ReadonlyMap<string, number> {
  return new Map(Object.entries(published));
}

/** The publish versions of a run that has published nothing yet. */
export function emptyPublished(): ReadonlyMap<string, number> {
  return new Map();
}

/** Due works not already published by an earlier attempt of this stable run id. */
export function pendingOf(due: readonly DueWork[], published: ReadonlyMap<string, number>): readonly DueWork[] {
  if (published.size === 0) return due;
  return due.filter((work) => !published.has(work.bangumiId));
}

/**
 * The ledger earlier attempts recorded, plus a reclaim entry when this attempt
 * reclaims a stale run. Marking the stale run failed writes this ledger, so the
 * reclaim is on the row even if this attempt never records.
 */
export function carriedFailures(existing: RunSnapshot | null, kind: ResumePlan["kind"]): readonly RunFailure[] {
  const recorded = existing?.failures ?? [];
  if (kind !== "stale") return recorded;
  return [...recorded, { stage: "reclaim", reason: "stale-reclaimed" }];
}
