/**
 * Release bundle budgets for the built client, read by the Web package's own
 * `test:integration` gate (tests/integration/bundle-budget.test.ts).
 *
 * Vite emits hashed chunks under .output/public/assets (e.g. index-CtOoht5q.js)
 * and an SSR manifest that names, per route, the chunks the document preloads.
 * Two kinds of budget read that output:
 *
 *   - a route budget (`routeBudgets`) is ONE route's first-load bytes: its entry
 *     chunk plus every chunk the manifest preloads for it — what a visitor must
 *     download before that route is interactive;
 *   - a chunk-family budget (`bundleBudgets`) caps one emitted chunk family by
 *     its un-hashed basename prefix, so a breach names the offending chunk.
 *
 * `routeBudgets.landing` replaced the `index` entry-chunk budget (380,000) when
 * vite 8.3 arrived. rolldown's chunking moved search-params, LocaleProvider,
 * RouteDetailStates and return-target (69,571 B) INTO index-*.js: the entry grew
 * 68,575 B (359,140 → 427,715) while the landing route's first load fell 1,014 B
 * (601,941 → 600,927) and the summed JS across every chunk fell 78,725 B
 * (3,055,955 → 2,977,230). The entry chunk was only ever a proxy for the landing
 * route's cost — those four modules ship on that route either way — so the budget
 * now measures the cost itself. Re-splitting the entry back under 380,000 with
 * hand-written chunking was rejected for the same reason: it would re-arrange the
 * same bytes to flatter the proxy instead of guarding the route.
 *
 * The number keeps the margin the 380,000 carried over the ambient entry at that
 * point — 380,000 / 359,140 = 1.05808 — applied to the measured first load:
 * 601,941 × 1.05808 = 636,904, rounded to 637,000 (36,073 B of headroom on the
 * vite 8.3 build).
 *
 * A budget over the summed JS of every chunk was rejected: that number moved
 * 78,725 B in the direction opposite to these budgets' subject, and it names no
 * route — a new route, a new locale or the map vendor are each legitimate
 * growths a total cannot separate from a regression. The map library is the
 * largest single asset but ships only on the map route, so it is budgeted as a
 * chunk family rather than folded into the landing route.
 *
 * Units are raw bytes, matched against the built .js size. Gating on a
 * regression is what matters — the "good" estimate is the ambient build size,
 * with headroom kept small so an accidental vendor/tree-shaking regression turns
 * the gate red and names the offending chunk.
 */
export const routeBudgets = {
  /** The landing route (`/`): the root route's preload graph, i.e. the app shell plus its vendors. */
  "landing": 637_000,
} as const;

export const bundleBudgets = {
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

/** The root route, whose `preloads` array is the landing route's first-load set. */
const ROOT_ROUTE = "__root__:{";

/** The manifest's first `preloads` array, which the root route's object owns. */
const ROOT_PRELOADS = /preloads:\[([^\]]*)\]/u;

/** A preload entry: an absolute `/assets/….js` path, as the built manifest writes it. */
const PRELOAD_PATH = /"\/assets\/[^"]+\.js"/gu;

/** One such path, split into the chunk basename it names. */
const PRELOAD_NAME = /^"\/assets\/(.+\.js)"$/u;

/**
 * The landing route's first-load chunk basenames, read from the built SSR manifest.
 *
 * The root route is the first route object the manifest emits, and its preloads are what the document
 * is served with — the entry chunk plus the shared chunks it statically imports. An empty result means
 * the manifest is not the shape this reader knows; the budget test fails on that rather than budgeting
 * an empty set.
 */
export function landingPreloads(manifestSource: string): string[] {
  const root = manifestSource.indexOf(ROOT_ROUTE);
  if (root === -1) return [];
  const [, list = ""] = ROOT_PRELOADS.exec(manifestSource.slice(root)) ?? [];
  const paths = list.match(PRELOAD_PATH) ?? [];
  return [...new Set(paths.map((path) => path.replace(PRELOAD_NAME, "$1")))];
}
