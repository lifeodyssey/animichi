/** How much of a `SetupBudget`'s deadline is left, and what a phase may spend.
 *
 * The phases run in sequence against one wall clock (#1318): the port bind is
 * offered everything still unspent, and each connection wait converts whatever
 * survives into attempts. One second buys one attempt, and the wait never
 * exceeds the budget's own ceiling however plentiful the deadline is.
 *
 * The clock is injected so the arithmetic is provable without a container.
 */
import type { StartupWaitLimits } from "./postgres-startup-wait.ts";
import type { SetupBudget } from "./setup-budget.ts";

export class SetupDeadline {
  #budget: SetupBudget;
  #now: () => number;
  #startedAt: number;

  constructor(budget: SetupBudget, now: () => number = Date.now) {
    this.#budget = budget;
    this.#now = now;
    this.#startedAt = now();
  }

  remainingMs(): number {
    return Math.max(0, this.#budget.deadlineMs - (this.#now() - this.#startedAt));
  }

  /** One pause buys one attempt, capped by the budget's own ceiling. */
  connectionAttempts(): number {
    const { attemptCeiling, pauseMs } = this.#budget.firstSession;
    return Math.min(attemptCeiling, Math.floor(this.remainingMs() / pauseMs));
  }

  /** The same allowance, in the shape the startup wait takes. */
  firstSessionLimits(): StartupWaitLimits {
    return { attemptCeiling: this.connectionAttempts(), pauseMs: this.#budget.firstSession.pauseMs };
  }
}
