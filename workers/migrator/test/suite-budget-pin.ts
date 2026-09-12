/** The assertion that keeps a scoped test budget from quietly disappearing.
 *
 * A `describe(name, { timeout }, …)` is invisible to anything outside the
 * file, so deleting it would simply return that suite to the package default
 * and nothing would go red until the next loaded run. Vitest resolves each
 * test's budget at collection time (`options.timeout ?? config.testTimeout`,
 * `@vitest/runner`) and publishes it as `task.timeout`, so a test inside the
 * suite can read the value that is actually in force — the effective number,
 * not the source text — and fail when it is not the one the suite declared.
 */
import { expect, it } from "vitest";

/** Pins the enclosing suite to `budgetMs`: red if the suite's own
 * `{ timeout }` is removed, and red if the package default is widened to
 * something else instead of scoping the budget here. */
export function pinsSuiteBudget(budgetMs: number): void {
  it(`runs under its own ${String(budgetMs)} ms budget, not the package default`, ({ task }) => {
    expect(task.timeout).toBe(budgetMs);
  });
}
