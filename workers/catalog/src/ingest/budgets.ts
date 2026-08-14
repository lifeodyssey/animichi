/**
 * Budget ledger for the daily discovery+ingest run (#1006 AC3).
 *
 * Three independent budgets constrain a run — work count, upstream request
 * count, and wall-clock runtime. Every limit comes from the caller-supplied
 * config; there are no source-code magic numbers here. The ledger is a pure
 * counter so it is deterministic and unit-testable, and the run orchestrator
 * stops cleanly the moment any dimension is exhausted.
 */
export interface BudgetLimits {
  /** Maximum works the run may ingest. */
  workLimit: number;
  /** Maximum upstream requests (bangumi + anitabi combined) the run may issue. */
  requestLimit: number;
  /** Maximum wall-clock runtime the run may consume, in milliseconds. */
  runtimeLimitMs: number;
}

/** The three budget dimensions; a short name for reports/messages. */
export type BudgetKind = "work" | "request" | "runtime";

/** Snapshot of budget consumption for run telemetry. */
export interface BudgetUsage {
  workUsed: number;
  requestUsed: number;
  runtimeUsedMs: number;
  limits: BudgetLimits;
}

/** Immutable per-dimension resource costs used to check the ledger. */
export interface BudgetRow {
  work: number;
  requests: number;
  runtimeMs: number;
}

/** Record one ingested work against the budget; throws when exhausted. */
export function spendWork(budget: Budget, requests: number, runtimeMs: number): void {
  budget.spend({ work: 1, requests: nonNegative(requests), runtimeMs: nonNegative(runtimeMs) });
}

/** Record upstream requests against the budget; throws when exhausted. */
export function spendRequests(budget: Budget, requests: number): void {
  budget.spend({ work: 0, requests: nonNegative(requests), runtimeMs: 0 });
}

/** Record elapsed wall-clock against the budget; throws when exhausted. */
export function spendRuntime(budget: Budget, runtimeMs: number): void {
  budget.spend({ work: 0, requests: 0, runtimeMs: nonNegative(runtimeMs) });
}

/** A pure counter: consume rows and report exhaustion in each dimension. */
export class Budget {
  private readonly limits: BudgetLimits;
  private workUsed = 0;
  private requestUsed = 0;
  private runtimeUsedMs = 0;

  constructor(limits: BudgetLimits) {
    this.limits = limits;
    assertPositive(limits.workLimit, "workLimit");
    assertPositive(limits.requestLimit, "requestLimit");
    assertPositive(limits.runtimeLimitMs, "runtimeLimitMs");
  }

  /** Consume a resource row; throws when any dimension exceeds its cap. */
  spend(row: BudgetRow): void {
    const next = this.nextUsage(row);
    assertWithin(next, this.limits);
    this.workUsed = next.workUsed;
    this.requestUsed = next.requestUsed;
    this.runtimeUsedMs = next.runtimeUsedMs;
  }

  /** True when the work cap has been reached or exceeded. */
  workExhausted(): boolean {
    return this.workUsed >= this.limits.workLimit;
  }

  /** True when the request cap has been reached or exceeded. */
  requestExhausted(): boolean {
    return this.requestUsed >= this.limits.requestLimit;
  }

  /** True when the runtime cap has been reached or exceeded. */
  runtimeExhausted(): boolean {
    return this.runtimeUsedMs >= this.limits.runtimeLimitMs;
  }

  /** First exhausted dimension, or null when still within every budget. */
  firstExhausted(): BudgetKind | null {
    if (this.workExhausted()) return "work";
    if (this.requestExhausted()) return "request";
    if (this.runtimeExhausted()) return "runtime";
    return null;
  }

  /** Current consumption snapshot for run telemetry. */
  usage(): BudgetUsage {
    return {
      workUsed: this.workUsed,
      requestUsed: this.requestUsed,
      runtimeUsedMs: this.runtimeUsedMs,
      limits: this.limits,
    };
  }

  /** The usage that would result from spending `row` (used for cap checks). */
  private nextUsage(row: BudgetRow): BudgetUsage {
    return {
      workUsed: this.workUsed + row.work,
      requestUsed: this.requestUsed + row.requests,
      runtimeUsedMs: this.runtimeUsedMs + row.runtimeMs,
      limits: this.limits,
    };
  }
}

/** Reject a prospective row that exceeds any limit. */
function assertWithin(next: BudgetUsage, limits: BudgetLimits): void {
  if (next.workUsed > limits.workLimit) throw new Error("work budget exhausted");
  if (next.requestUsed > limits.requestLimit) throw new Error("request budget exhausted");
  if (next.runtimeUsedMs > limits.runtimeLimitMs) throw new Error("runtime budget exhausted");
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
