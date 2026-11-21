/**
 * Budget ledger for the daily discovery+ingest run (#1006 AC3).
 *
 * Two independent budgets constrain a run — work count and upstream request
 * count. Every limit comes from the caller-supplied config; there are no
 * source-code magic numbers here. The ledger is a pure counter so it is
 * deterministic and unit-testable, and the run orchestrator stops cleanly the
 * moment either dimension is exhausted. Wall-clock time is not a dimension: a
 * cron pass is bounded by its own deadline (`CRON_PASS_DEADLINE_MS`).
 */
export interface BudgetLimits {
  /** Maximum works the run may ingest. */
  workLimit: number;
  /** Maximum upstream requests (bangumi + anitabi combined) the run may issue. */
  requestLimit: number;
}

/** The two budget dimensions; a short name for reports/messages. */
export type BudgetKind = "work" | "request";

/** Snapshot of budget consumption for run telemetry. */
export interface BudgetUsage {
  workUsed: number;
  requestUsed: number;
  limits: BudgetLimits;
}

/** Immutable per-dimension resource costs used to check the ledger. */
export interface BudgetRow {
  work: number;
  requests: number;
}

/** The resource cost of one daily-run work ingest (fetch both sources). */
export const INGEST_WORK_COST: BudgetRow = { work: 1, requests: 2 };

/** True when the budget can still accommodate a single work ingest. */
export function canSpendWork(budget: Budget): boolean {
  return budget.canSpend(INGEST_WORK_COST);
}

/** Record one ingested work against the budget; throws when exhausted. */
export function spendWork(budget: Budget, requests: number): void {
  budget.spend({ work: 1, requests: nonNegative(requests) });
}

/** Record upstream requests against the budget; throws when exhausted. */
export function spendRequests(budget: Budget, requests: number): void {
  budget.spend({ work: 0, requests: nonNegative(requests) });
}

/** A pure counter: consume rows and report exhaustion in each dimension. */
export class Budget {
  private readonly limits: BudgetLimits;
  private workUsed = 0;
  private requestUsed = 0;

  constructor(limits: BudgetLimits) {
    this.limits = limits;
    assertPositive(limits.workLimit, "workLimit");
    assertPositive(limits.requestLimit, "requestLimit");
  }

  /** Consume a resource row; throws when any dimension exceeds its cap. */
  spend(row: BudgetRow): void {
    const next = this.nextUsage(row);
    assertWithin(next, this.limits);
    this.workUsed = next.workUsed;
    this.requestUsed = next.requestUsed;
  }

  /** True when spending `row` now would exceed no limit (non-throwing). */
  canSpend(row: BudgetRow): boolean {
    return firstBlocking(this.nextUsage(row), this.limits) === null;
  }

  /** The dimension `row` would exceed if spent now, or null when it fits. */
  blockedBy(row: BudgetRow): BudgetKind | null {
    return firstBlocking(this.nextUsage(row), this.limits);
  }

  /** True when the work cap has been reached or exceeded. */
  workExhausted(): boolean {
    return this.workUsed >= this.limits.workLimit;
  }

  /** True when the request cap has been reached or exceeded. */
  requestExhausted(): boolean {
    return this.requestUsed >= this.limits.requestLimit;
  }

  /** First exhausted dimension, or null when still within every budget. */
  firstExhausted(): BudgetKind | null {
    if (this.workExhausted()) return "work";
    if (this.requestExhausted()) return "request";
    return null;
  }

  /** Current consumption snapshot for run telemetry. */
  usage(): BudgetUsage {
    return {
      workUsed: this.workUsed,
      requestUsed: this.requestUsed,
      limits: this.limits,
    };
  }

  /** The usage that would result from spending `row` (used for cap checks). */
  private nextUsage(row: BudgetRow): BudgetUsage {
    return {
      workUsed: this.workUsed + row.work,
      requestUsed: this.requestUsed + row.requests,
      limits: this.limits,
    };
  }
}

/** Reject a prospective row that exceeds any limit. */
function assertWithin(next: BudgetUsage, limits: BudgetLimits): void {
  if (next.workUsed > limits.workLimit) throw new Error("work budget exhausted");
  if (next.requestUsed > limits.requestLimit) throw new Error("request budget exhausted");
}

/** The first limit `next` would exceed, or null when every dimension fits. */
function firstBlocking(next: BudgetUsage, limits: BudgetLimits): BudgetKind | null {
  if (next.workUsed > limits.workLimit) return "work";
  if (next.requestUsed > limits.requestLimit) return "request";
  return null;
}

function assertPositive(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(name + " must be a positive integer");
  }
}

function nonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("budget consumption must be non-negative");
  return value;
}
