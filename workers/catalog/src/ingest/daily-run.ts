/**
 * Daily discovery + ingest run (#1006 AC1, AC6).
 *
 * One durable run per UTC day, keyed by a STABLE run id (daily-YYYY-MM-DD) so a
 * retry is idempotent: re-running a completed day returns the already-recorded
 * outcome instead of fetching and publishing again. The run row records the
 * discovered target set, per-source outcomes, budget use, the failures of every
 * attempt (a retry appends to that ledger), completion state, and the publish
 * version each work reached. A partial or failed run is NEVER marked complete,
 * and a failed work never advances its published pointer.
 *
 * The orchestrator is a pure plan over injected ports so the run-state protocol
 * is deterministically unit-testable; the production adapter wires real
 * discovery, ingest, provenance, and raw-history persistence through the
 * CatalogDb seam (see `catalogDailyRun`).
 */
import { Budget, INGEST_WORK_COST, type BudgetLimits } from "./budgets";
import { mergeDiscovery, type DiscoveryInput, type DiscoveryResult } from "./discovery";
import { carriedFailures, emptyPublished, pendingOf, resumeOf } from "./run-resume";
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

/** A work that failed at one stage of its ingest, and why. */
interface WorkFailure {
  bangumiId: string;
  stage: "fetch" | "enrich" | "quality";
  reason: string;
}

/** A stale `running` attempt reclaimed by a retry. It names no work: the run row it is recorded in names the run. */
interface ReclaimFailure {
  stage: "reclaim";
  reason: string;
}

/** A failure this run protocol records: a work's, or a reclaim's. */
export type RunFailure = WorkFailure | ReclaimFailure;

/**
 * A ledger element this code does not recognise: another version of the run
 * store, or a hand edit, recorded it. A retry carries it forward unread, and
 * only the run store writes it back, as the value it read (what that value
 * keeps: `recordedLedger` in `run-store.ts`).
 */
export interface UnrecognisedLedgerEntry {
  readonly unrecognised: unknown;
}

/** One entry of a run's failure ledger, which a retry appends to and never replaces. */
export type RunLedgerEntry = RunFailure | UnrecognisedLedgerEntry;

/** The durable snapshot a run writes when it transitions. */
export interface RunSnapshot {
  status: RunStatus;
  targets: DiscoveryResult | null;
  sources: Record<string, SourceOutcome>;
  budgetUsed: { workUsed: number; requestUsed: number; runtimeUsedMs: number };
  firstExhausted: string | null;
  failures: RunLedgerEntry[];
  published: Record<string, number>;
  /** When the run row was started (ms epoch); null when unknown. Drives stale reclaim. */
  startedAtMs: number | null;
}

/** One attempt's own snapshot: every failure in it is one this attempt recorded, so its status counts nothing carried. */
interface AttemptSnapshot extends RunSnapshot {
  failures: RunFailure[];
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
  | { outcome: "fetchFailed"; source: RunSource; attempted: readonly RunSource[]; reason: string }
  | { outcome: "pipelineFailed"; stage: "enrich" | "quality"; reason: string }
  | { outcome: "exhausted" };

/** Ports the run plan calls; production wires these to the CatalogDb seam. */
export interface RunPorts {
  /** Read the stable run row (idempotency gate). */
  readRun: (runId: string) => Promise<RunSnapshot | null>;
  /** Reserve the run row atomically; false when another invocation owns it. */
  beginRun: (runId: string) => Promise<boolean>;
  /** Persist a run snapshot transition. */
  recordRun: (runId: string, snapshot: RunSnapshot) => Promise<void>;
  /** Ingest one work; consumes budget and reports a per-source outcome. */
  ingestWork: (bangumiId: string, tier: TierName, budget: Budget) => Promise<RunWorkOutcome>;
  /** Bounded raw-history cleanup after the run (protects this run's evidence). */
  cleanup: (runId: string) => Promise<number>;
  /** Mark a stale run failed before a retry re-runs it, recording its ledger with the reclaim entry appended. */
  markRunFailed: (runId: string, failures: readonly RunLedgerEntry[]) => Promise<void>;
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
  const existing = await ports.readRun(plan.runId);
  if (existing?.status === "complete") return existing;
  const resume = resumeOf(existing, plan);
  if (resume.kind === "skip") return resume.existing;
  const carried = carriedFailures(existing, resume.kind);
  if (resume.kind === "stale") await ports.markRunFailed(plan.runId, carried);
  if (!(await ports.beginRun(plan.runId))) return inFlight();
  const snapshot = await runAttempt(ports, plan, resume.published);
  return recordAttempt(ports, plan.runId, snapshot, carried);
}

/** Ingest the due works this run id has not published yet; the status counts this attempt alone. */
async function runAttempt(ports: RunPorts, plan: RunPlan, published: ReadonlyMap<string, number>): Promise<AttemptSnapshot> {
  const budget = new Budget(plan.policy.budget);
  const merged = mergeDiscovery(plan.knownIds, plan.discovery, plan.policy.newWorkCap);
  const due = selectDueWorks(plan.tiered, tiersFromConfig(plan.policy.tierIntervals), plan.epochMs, plan.policy.budget.workLimit);
  const snapshot = freshSnapshot(merged, published);
  await executeDue(ports, plan, pendingOf(due, published), snapshot, budget);
  snapshot.status = finalStatus(due.length, snapshot);
  return snapshot;
}

/**
 * Record the attempt with the carried ledger ahead of its own failures. Its
 * status is already decided, so an entry an earlier attempt left cannot hold a
 * recovered run at `partial`.
 */
async function recordAttempt(
  ports: RunPorts,
  runId: string,
  snapshot: AttemptSnapshot,
  carried: readonly RunLedgerEntry[],
): Promise<RunSnapshot> {
  const recorded: RunSnapshot = { ...snapshot, failures: [...carried, ...snapshot.failures] };
  await ports.cleanup(runId);
  await ports.recordRun(runId, recorded);
  return recorded;
}

/** A zeroed snapshot for a fresh run, seeding any resumed publish versions. */
function freshSnapshot(targets: DiscoveryResult, seed: ReadonlyMap<string, number> = emptyPublished()): AttemptSnapshot {
  return {
    status: "running",
    targets,
    sources: sourceLedger(),
    budgetUsed: { workUsed: 0, requestUsed: 0, runtimeUsedMs: 0 },
    firstExhausted: null,
    failures: [],
    published: Object.fromEntries(seed),
    startedAtMs: null,
  };
}

/** A minimal snapshot for a run owned by another live invocation. */
function inFlight(): RunSnapshot {
  return { ...freshSnapshot({ works: [], uniqueSeen: 0, knownCount: 0, newCount: 0, cappedCount: 0 }), status: "running" };
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
  snapshot: AttemptSnapshot,
  budget: Budget,
): Promise<void> {
  for (const work of due) {
    if (budget.firstExhausted() !== null) break;
    const outcome = await ports.ingestWork(work.bangumiId, work.tier, budget);
    if (outcome.outcome === "exhausted") {
      snapshot.firstExhausted = budget.blockedBy(INGEST_WORK_COST);
      break;
    }
    applyOutcome(snapshot, budget, work.bangumiId, outcome);
  }
  if (budget.firstExhausted() !== null) snapshot.firstExhausted = budget.firstExhausted();
}
/** Fold one work outcome into the snapshot ledger. */
function applyOutcome(
  snapshot: AttemptSnapshot,
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
    for (const source of outcome.attempted) {
      markSource(snapshot.sources, source, source === outcome.source ? "failed" : "ok");
    }
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
function finalStatus(dueCount: number, snapshot: AttemptSnapshot): RunStatus {
  const successCount = Object.keys(snapshot.published).length;
  if (dueCount === 0) return "complete";
  if (successCount === dueCount && snapshot.failures.length === 0) return "complete";
  if (successCount > 0) return "partial";
  return "failed";
}
