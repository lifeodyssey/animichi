/**
 * Single source of truth for cross-service Catalog error codes.
 *
 * Mirrors live in `workers/catalog/src/lib/errors.ts` (TS, no zod) and
 * `apps/agent/agent/clients/catalog_errors.py` (Python). Keep all three in
 * lockstep.
 */

import { z } from "zod";

/**
 * Catalog error category semantics:
 * `user_actionable` means the caller's user can change something to succeed,
 * so do not retry. `retryable` means a transient infra/upstream failure where
 * retrying with backoff may succeed. `system` means our-side fault, so do not
 * retry and show a generic apology.
 */
export const ErrorCategory = z.enum(["user_actionable", "retryable", "system"]);
/** Inferred TS type for Catalog error category semantics. */
export type ErrorCategory = z.infer<typeof ErrorCategory>;

/** Data carried when route planning spans too many geographic areas. */
export const RouteTooManyClustersData = z.object({
  cluster_count: z.number().int(),
  max_clusters: z.number().int(),
});
/** Inferred TS type for route-too-many-clusters error data. */
export type RouteTooManyClustersData = z.infer<typeof RouteTooManyClustersData>;

/** Data carried when a route request includes too many point IDs. */
export const RouteTooManyPointsData = z.object({
  point_count: z.number().int(),
  max_points: z.number().int(),
});
/** Inferred TS type for route-too-many-points error data. */
export type RouteTooManyPointsData = z.infer<typeof RouteTooManyPointsData>;

/** Data carried when no pilgrimage points exist for a Bangumi work. */
export const WorkNotFoundData = z.object({
  bangumi_id: z.string(),
});
/** Inferred TS type for work-not-found error data. */
export type WorkNotFoundData = z.infer<typeof WorkNotFoundData>;

/** Data carried when an upstream catalog source is unavailable. */
export const UpstreamUnavailableData = z.object({
  upstream: z.enum(["bangumi", "anitabi", "unknown"]),
});
/** Inferred TS type for upstream-unavailable error data. */
export type UpstreamUnavailableData = z.infer<typeof UpstreamUnavailableData>;

type CatalogErrorDefItem = {
  readonly status: number;
  readonly category: ErrorCategory;
  readonly message: string;
  readonly data: z.ZodType<unknown>;
};

/**
 * Catalog error registry with categories kept out of the oRPC wire envelope.
 *
 * Clients derive category from code using their own mirror tables.
 */
export const CATALOG_ERROR_DEFS = {
  ROUTE_TOO_MANY_CLUSTERS: {
    status: 422,
    category: "user_actionable",
    message: "Route exceeds the maximum number of areas",
    data: RouteTooManyClustersData,
  },
  ROUTE_TOO_MANY_POINTS: {
    status: 400,
    category: "user_actionable",
    message: "Too many point_ids for a single route",
    data: RouteTooManyPointsData,
  },
  WORK_NOT_FOUND: {
    status: 404,
    category: "user_actionable",
    message: "No pilgrimage points for this work",
    data: WorkNotFoundData,
  },
  UPSTREAM_UNAVAILABLE: {
    status: 502,
    category: "retryable",
    message: "Upstream catalog source unavailable",
    data: UpstreamUnavailableData,
  },
} as const satisfies Record<string, CatalogErrorDefItem>;

/** Catalog error registry type. */
export type CatalogErrorDefs = typeof CATALOG_ERROR_DEFS;
/** Catalog error code union. */
export type CatalogErrorCode = keyof CatalogErrorDefs;

type CatalogErrorMapItem<Code extends CatalogErrorCode> = {
  status: CatalogErrorDefs[Code]["status"];
  message: CatalogErrorDefs[Code]["message"];
  data: CatalogErrorDefs[Code]["data"];
};

type CatalogErrorMap<Code extends CatalogErrorCode> = {
  [Key in Code]: CatalogErrorMapItem<Key>;
};

function catalogErrorEntry<Code extends CatalogErrorCode>(
  code: Code,
): readonly [Code, CatalogErrorMapItem<Code>] {
  const { status, message, data } = CATALOG_ERROR_DEFS[code];
  return [code, { status, message, data }];
}

/** Pick oRPC error map entries and drop registry-only category metadata. */
export function pickCatalogErrors<const Code extends CatalogErrorCode>(
  codes: readonly Code[],
): CatalogErrorMap<Code> {
  return Object.fromEntries(codes.map(catalogErrorEntry)) as CatalogErrorMap<Code>;
}
