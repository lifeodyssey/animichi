/**
 * Release bundle budgets for the built client, shared by the budget assertion
 * tests/integration/bundle-budget.test.ts and the Web / build CI job.
 *
 * Vite emits hashed, route-family chunks under .output/public/assets (e.g.
 * index-CtOoht5q.js). A budget is keyed by the un-hashed basename prefix that
 * names the family (the hash is stripped before matching), so a budget number
 * can be raised/lowered without churning the config on every content hash.
 *
 * Units are raw bytes, matched against the built .js size. Gating on a
 * regression is what matters — the "good" estimate is the ambient build size,
 * with headroom kept small so an accidental vendor/tree-shaking regression
 * turns the gate red and names the offending chunk. The map library is the
 * largest single asset but only ships on the map route; it is budgeted
 * separately rather than folding into the landing entry.
 */
export const bundleBudgets = {
  /** Landing/app-shell entry (index-*.js): router + landing page + shell. */
  "index": 380_000,
  /** Chat route entry (chat-*.js): the interactive planner surface. */
  "chat": 260_000,
  /** MapLibre GL vendor bundle (maplibre-gl-*.js), loaded only on map routes. */
  "maplibre-gl": 1_150_000,
} as const;

export type BundleBudgetKey = keyof typeof bundleBudgets;

/** Routes a hashed built chunk basename to its budget key by stripping the
 * -HASH suffix, or null when the chunk family is not budgeted. */
export function budgetKeyFor(basename: string): BundleBudgetKey | null {
  for (const key of Object.keys(bundleBudgets) as BundleBudgetKey[]) {
    if (basename.startsWith(`${key}-`)) return key;
  }
  return null;
}

/** TRUE when the built chunk exceeds its release budget, else FALSE. */
export function isOverBudget(basename: string, bytes: number): boolean {
  const key = budgetKeyFor(basename);
  return key !== null && bytes > bundleBudgets[key];
}
