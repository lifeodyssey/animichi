/** Tool budgets for tests: one that never elapses, and one that already has.
 * The clock is never real here — an 85-second deadline is asserted by handing
 * the tool a signal that is already aborted. Named for what it builds, per
 * .claude/rules/naming-ownership.md. */
import type { ToolBudget } from "../../src/agent/tools/catalog-timeouts.ts";

/** A budget that never runs out: only the turn's own signal can abort. */
export const unspentBudget: ToolBudget = (signal) => signal ?? new AbortController().signal;

/** A budget that has already elapsed before the tool starts. */
export const spentBudget: ToolBudget = () => AbortSignal.abort();
