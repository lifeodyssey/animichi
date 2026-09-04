/**
 * The catalog tools' timeout ladder, ported from `apps/agent`.
 *
 * Each rung must stay strictly inside the next: one attempt (25s) < the whole
 * call including retries (80s) < the tool budget pi enforces (85s,
 * `animichi_tools.py::CATALOG_TOOL_TIMEOUT_SECONDS`). Python asserted exactly
 * that ordering in `test_timeout_budgets.py`, and this module is asserted the
 * same way so the ladder cannot be flattened by accident.
 */

/** One HTTP attempt against the catalog. */
export const CATALOG_REQUEST_TIMEOUT_MS = 25_000;

/** One catalog call, retries included. */
export const CATALOG_TOTAL_TIMEOUT_MS = 80_000;

/** One tool execution, as pi budgets it. */
export const CATALOG_TOOL_TIMEOUT_MS = 85_000;

/** How many attempts one catalog call gets before it degrades. */
export const CATALOG_MAX_ATTEMPTS = 3;

/**
 * The deadline one tool execution runs under.
 *
 * Python got this from pydantic-ai, which enforced `Tool(timeout=…)` outside
 * the tool body (`animichi_tools.py::TOOLS`); pi has no such field, so the
 * outermost rung is ours to hold or it is not held at all. It is a value rather
 * than a call inside the tools so a test can hand them a budget that has
 * already elapsed instead of waiting 85 seconds for one.
 */
export type ToolBudget = (signal?: AbortSignal) => AbortSignal;

/**
 * The production budget: the turn's own deadline, and this tool's 85 seconds.
 *
 * Named for the execution rather than for the catalog because it is not the
 * catalog's: `translate_anime_title` runs under the same ceiling (#1287), and
 * `web_search` under its own tighter one. This is simply the deadline pi does
 * not enforce.
 */
export const toolExecutionBudget: ToolBudget = (signal) => {
  const own = AbortSignal.timeout(CATALOG_TOOL_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, own]) : own;
};
