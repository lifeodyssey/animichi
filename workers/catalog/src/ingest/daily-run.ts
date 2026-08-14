/**
 * Daily discovery + ingest run (#1006 AC1, AC6).
 *
 * One durable run per UTC day, keyed by a STABLE run id (daily-YYYY-MM-DD) so a
 * retry is idempotent: re-running a completed day returns the already-recorded
 * outcome instead of fetching and publishing again. The run row records the
 * discovered target set, per-source outcomes, budget use, failures, completion
 * state, and the publish version each work reached. A partial or failed run is
 * NEVER marked complete, and a failed work never advances its published pointer.
 *
 * The orchestrator is a pure plan over injected ports so the run-state protocol
 * is deterministically unit-testable; the production adapter wires real
 * discovery, ingest, provenance, and raw-history persistence through the
 * CatalogDb seam (see `catalogDailyRun`).
 */
import { Budget, type BudgetLimits } from "./budgets";
import { mergeDiscovery, type DiscoveryInput, type DiscoveryResult } from "./discovery";
import { selectDueWorks, tiersFromConfig, type DueWork, type TierName, type TieredWork } from "./tiers";

/** The completion state a run may reach. */
export type RunStatus = "pending" | "running" | "partial" | "failed" | "complete";

/** Per-source ingest outcome tallies for a run. */
export interface SourceOutcome {
  attempted: number;
  ok: number;
  failed: number;
  empty: number;
}

/** A recorded failure: which work, which stage, and the reason. */
export interface RunFailure {
  bangumiId: string;
  stage: "fetch" | "enrich" | "quality";
  reason: string;
}

/** The durable snapshot a run writes when it transitions. */
export interface RunSnapshot {
  status: RunStatus;
  targets: DiscoveryResult | null;
  sources: Record<string, SourceOutcome>;
  budgetUsed: { workUsed: number; requestUsed: number; runtimeUsedMs: number };
  firstExhausted: string | null;
  failures: RunFailure[];
  published: Record<string, number>;
}

/** Non-source-code knobs for the run (all caller-supplied). */
export interface RunPolicy {
  /** A run left `running` this long (ms) is stale and may be reclaimed. */
  staleRunningMs: number;
  /** Per-tier refresh intervals in ms. */
  tierIntervals: Record<TierName, number>;
  /** Bounded daily growth: max brand-new works admitted per run. */
  newWorkCap: number;
  /** Historical raw payloads to keep per work/source after a run. */
  keepHistory: number;
  /** The three dimension budgets for the run. */
  budget: BudgetLimits;
}
/** A source fetch within the run. */
export type RunSource = "bangumi" | "anitabi";

/** Per-work ingest outcome reported back to the orchestrator. */
export type RunWorkOutcome =
  | { outcome: "ingested"; version: number }
  | { outcome: "empty"; source: RunSource; reason: string }
  | { outcome: "fetchFailed"; source: RunSource; reason: string }
  | { outcome: "pipelineFailed"; stage: "enrich" | "quality"; reason: string }
  | { outcome: "exhausted" };

/** Ports the run plan calls; production wires these to the CatalogDb seam. */
export interface RunPorts {
  /** Read the stable run row (idempotency gate). */
  readRun: (runId: string) => Promise<RunSnapshot | null>;
  /** Reserve the run row atomically; no-op when a retry already holds it. */
  beginRun: (runId: string) => Promise<void>;
  /** Persist a run snapshot transition. */
  recordRun: (runId: string, snapshot: RunSnapshot) => Promise<void>;
  /** Ingest one work; consumes budget and reports a per-source outcome. */
  ingestWork: (bangumiId: string, tier: TierName, budget: Budget) => Promise<RunWorkOutcome>;
  /** Bounded raw-history cleanup after the run (protects this run's evidence). */
  cleanup: (runId: string) => Promise<number>;
}

/** Plan inputs for one run. */
export interface RunPlan {
  runId: string;
  epochMs: number;
  discovery: readonly DiscoveryInput[];
  knownIds: ReadonlySet<string>;
  tiered: readonly TieredWork[];
  policy: RunPolicy;
}

/** Run the daily ingest over injected ports (pure protocol). */
export async function runDailyIngestWith(
  ports: RunPorts,
  plan: RunPlan,
): Promise<RunSnapshot> {
  const completed = await readCompleted(ports, plan.runId);
  if (completed) return completed;
  const budget = new Budget(plan.policy.budget);
  const merged = mergeDiscovery(plan.knownIds, plan.discovery, plan.policy.newWorkCap);
  const due = selectDueWorks(plan.tiered, tiersFromConfig(plan.policy.tierIntervals), plan.epochMs, plan.policy.budget.workLimit);
  const snapshot = freshSnapshot(merged);
  await ports.beginRun(plan.runId);
  await executeDue(ports, plan, due, snapshot, budget);
  snapshot.status = finalStatus(due.length, snapshot);
  await ports.cleanup(plan.runId);
  await ports.recordRun(plan.runId, snapshot);
  return snapshot;
}

/** A completed run is an idempotent no-op for the same stable run id. */
async function readCompleted(ports: RunPorts, runId: string): Promise<RunSnapshot | null> {
  const existing = await ports.readRun(runId);
  return existing?.status === "complete" ? existing : null;
}

/** A zeroed snapshot for a fresh/reclaimed run. */
function freshSnapshot(targets: DiscoveryResult): RunSnapshot {
  return {
    status: "running",
    targets,
    sources: sourceLedger(),
    budgetUsed: { workUsed: 0, requestUsed: 0, runtimeUsedMs: 0 },
    firstExhausted: null,
    failures: [],
    published: {},
  };
}

/** A zeroed per-source ledger for the two upstream sources. */
function sourceLedger(): Record<string, SourceOutcome> {
  return { bangumi: zeroSource(), anitabi: zeroSource() };
}

function zeroSource(): SourceOutcome {
  return { attempted: 0, ok: 0, failed: 0, empty: 0 };
}

/** Ingest each due work until a budget is exhausted or the set is processed. */
async function executeDue(
  ports: RunPorts,
  plan: RunPlan,
  due: readonly DueWork[],
  snapshot: RunSnapshot,
  budget: Budget,
): Promise<void> {
  for (const work of due) {
    if (budget.firstExhausted() !== null) break;
    const outcome = await ports.ingestWork(work.bangumiId, work.tier, budget);
    applyOutcome(snapshot, budget, work.bangumiId, outcome);
  }
  if (budget.firstExhausted() !== null) snapshot.firstExhausted = budget.firstExhausted();
}
/** Fold one work outcome into the snapshot ledger. */
function applyOutcome(
  snapshot: RunSnapshot,
  budget: Budget,
  bangumiId: string,
  outcome: RunWorkOutcome,
): void {
  if (outcome.outcome === "exhausted") {
    snapshot.firstExhausted = budget.firstExhausted();
    return;
  }
  snapshot.budgetUsed = budget.usage();
  if (outcome.outcome === "ingested") {
    snapshot.published[bangumiId] = outcome.version;
    markSource(snapshot.sources, "bangumi", "ok");
    markSource(snapshot.sources, "anitabi", "ok");
    return;
  }
  if (outcome.outcome === "empty") {
    markSource(snapshot.sources, outcome.source, "empty");
    markOther(snapshot.sources, outcome.source, "ok");
    return;
  }
  if (outcome.outcome === "fetchFailed") {
    markSource(snapshot.sources, outcome.source, "failed");
    markOther(snapshot.sources, outcome.source, "ok");
    return;
  }
  snapshot.failures.push({ bangumiId, stage: outcome.stage, reason: outcome.reason });
  markSource(snapshot.sources, "bangumi", "ok");
  markSource(snapshot.sources, "anitabi", "ok");
}
/** Tally one source as a given outcome (attempted + the specific counter). */
function markSource(ledger: Record<string, SourceOutcome>, source: RunSource, field: keyof SourceOutcome): void {
  const entry = ledger[source];
  if (entry) {
    entry[field] = entry[field] + 1;
    entry.attempted = entry.attempted + 1;
  }
}

/** Tally the OTHER source as ok (the one that did not fail/empty). */
function markOther(ledger: Record<string, SourceOutcome>, source: RunSource, field: keyof SourceOutcome): void {
  const other: RunSource = source === "bangumi" ? "anitabi" : "bangumi";
  markSource(ledger, other, field);
}

/** The final run status from how many works succeeded vs failed. */
function finalStatus(dueCount: number, snapshot: RunSnapshot): RunStatus {
  const successCount = Object.keys(snapshot.published).length;
  if (dueCount === 0) return "complete";
  if (successCount === dueCount && snapshot.failures.length === 0) return "complete";
  if (successCount > 0) return "partial";
  return "failed";
}
