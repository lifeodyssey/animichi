/**
 * The public catalog surface — the ONE anonymous catalog exposure (#1691).
 *
 * `apps/web` resolves its catalog client at the edge origin (`src/api/config.ts`,
 * same-origin by design, #550), and the edge is the only public door catalog
 * has. The record settles that: iter-5 S5.4 gives the root Worker the
 * `/catalog/public/*` forward to the `env.CATALOG` service binding;
 * `docs/ops/deployment.md` says catalog has no public host and is reached only
 * through the edge's service bindings; `infra/src/buckets.ts` says the same.
 * The zone route table that makes it true is declared in
 * `infra/src/web-routes.ts` and cross-checked by
 * `infra/topology-edge-route-coverage.test.ts`.
 *
 * This module is the surface's single declaration. The edge gateway reads the
 * path matcher, and BOTH the edge gateway and the catalog Worker read the
 * query-parameter allowlist, so a parameter one side accepts can never be one
 * the other rejects. Keep it import-free: the edge Worker bundles it, and
 * `test/import-free-modules.test.ts` holds the property that keeps zod out of
 * that bundle (#1285).
 *
 * Every value here is pinned to `catalogContract` by
 * `test/public-catalog.test.ts` — this is a projection of the contract, never
 * a second vocabulary to keep in sync by hand.
 */

/** The one anonymous catalog prefix. */
export const PUBLIC_CATALOG_PREFIX = "/catalog/public/";

/** One public catalog route. */
export interface PublicCatalogRoute {
  /** The contract's route template, `{param}` segments included. */
  readonly template: string;
  /**
   * The query parameter names the route's input declares — the input's keys
   * minus the ones the template consumes, which is what the OpenAPI client
   * serializes for a GET. A name not listed here is rejected before it is
   * forwarded, so every accepted name stays part of the cache key.
   */
  readonly queryParams: readonly string[];
}

export const PUBLIC_CATALOG_ROUTES: readonly PublicCatalogRoute[] = [
  { template: "/catalog/public/anime-overview/{bangumi_id}", queryParams: [] },
  { template: "/catalog/public/popular", queryParams: ["limit"] },
];

/**
 * Per-parameter matcher constraints. A parameter without an entry matches any
 * non-slash run, mirroring an unconstrained contract string input; `bangumi_id`
 * carries `AnimeOverviewInput`'s own `^\d+$`, so an encoded separator cannot
 * extend the forward.
 */
const PARAM_PATTERNS: Readonly<Record<string, string>> = { bangumi_id: "\\d+" };

function segmentMatcher(segment: string): string {
  const param = /^\{([^}]+)\}$/.exec(segment);
  if (param !== null) return PARAM_PATTERNS[param[1] ?? ""] ?? "[^/]+";
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matcherSource(template: string): string {
  return template.split("/").map(segmentMatcher).join("/");
}

const MATCHERS: readonly RegExp[] = PUBLIC_CATALOG_ROUTES.map(
  (route) => new RegExp(`^${matcherSource(route.template)}$`),
);

function publicCatalogRoute(pathname: string): PublicCatalogRoute | null {
  const index = MATCHERS.findIndex((matcher) => matcher.test(pathname));
  return index === -1 ? null : PUBLIC_CATALOG_ROUTES[index] ?? null;
}

/** Whether the path is on the public catalog surface. */
export function isPublicCatalogPath(pathname: string): boolean {
  return publicCatalogRoute(pathname) !== null;
}

/**
 * The first query parameter name the path's route does not declare, or null
 * when every name is declared. A path no route declares has no declared
 * parameters at all, so any name on it is unexpected.
 */
export function unexpectedPublicCatalogQueryParam(
  pathname: string,
  names: readonly string[],
): string | null {
  if (names.length === 0) return null;
  const declared = publicCatalogRoute(pathname)?.queryParams ?? [];
  return names.find((name) => !declared.includes(name)) ?? null;
}
