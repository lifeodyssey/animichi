/**
 * Mirror of packages/contract/src/errors.ts.
 *
 * MUST stay in lockstep with the contract registry; parity is enforced by
 * test/contract-parity.worker.test.ts. No zod imports are allowed here because
 * this module is bundled into the Worker.
 */

import { ORPCError, type } from "@orpc/server";

/** Catalog error category semantics, mirrored from the contract. */
export type ErrorCategory = "user_actionable" | "retryable" | "system";

/** Data carried when route planning spans too many geographic areas. */
export interface RouteTooManyClustersData {
  cluster_count: number;
  max_clusters: number;
}

/** Data carried when a route request includes too many point IDs. */
export interface RouteTooManyPointsData {
  point_count: number;
  max_points: number;
}

/** Data carried when no pilgrimage points exist for a Bangumi work. */
export interface WorkNotFoundData {
  bangumi_id: string;
}

/** Upstream source names surfaced in the typed retryable error. */
export type UpstreamSource = "bangumi" | "anitabi" | "unknown";

/** Data carried when an upstream catalog source is unavailable. */
export interface UpstreamUnavailableData {
  upstream: UpstreamSource;
}

/** Worker-local mirror of the catalog error registry. */
export const CATALOG_ERRORS = {
  ROUTE_TOO_MANY_CLUSTERS: {
    status: 422,
    category: "user_actionable",
    message: "Route exceeds the maximum number of areas",
  },
  ROUTE_TOO_MANY_POINTS: {
    status: 400,
    category: "user_actionable",
    message: "Too many point_ids for a single route",
  },
  WORK_NOT_FOUND: {
    status: 404,
    category: "user_actionable",
    message: "No pilgrimage points for this work",
  },
  UPSTREAM_UNAVAILABLE: {
    status: 502,
    category: "retryable",
    message: "Upstream catalog source unavailable",
  },
} as const;

export type CatalogErrors = typeof CATALOG_ERRORS;
export type CatalogErrorCode = keyof CatalogErrors;

/** One oRPC `.errors()` declaration derived from the registry (status + message
 * from the mirror; `type<T>()` is oRPC's zod-free passthrough validator). */
function declaration<Code extends CatalogErrorCode, Schema>(
  code: Code,
  data: Schema,
): { status: CatalogErrors[Code]["status"]; message: CatalogErrors[Code]["message"]; data: Schema } {
  const def = CATALOG_ERRORS[code];
  return { status: def.status, message: def.message, data };
}

/**
 * Per-procedure `.errors()` declarations, mirroring the contract's
 * `pickCatalogErrors([...])` attachments in packages/contract/src/contract.ts.
 *
 * Declaring a code on the procedure is REQUIRED for `defined: true` to survive
 * serialization: the server's validateORPCError rewrites any thrown ORPCError
 * whose code is NOT in the procedure's error map to `defined: false`. Keeping
 * the maps per-procedure (not on the shared base) means an error thrown from
 * the wrong procedure surfaces as visible drift instead of being blessed.
 */
export const ROUTE_ERRORS = {
  ROUTE_TOO_MANY_CLUSTERS: declaration("ROUTE_TOO_MANY_CLUSTERS", type<RouteTooManyClustersData>()),
  ROUTE_TOO_MANY_POINTS: declaration("ROUTE_TOO_MANY_POINTS", type<RouteTooManyPointsData>()),
};

/** `spots` procedure error declarations — mirrors the contract attachment. */
export const SPOTS_ERRORS = {
  WORK_NOT_FOUND: declaration("WORK_NOT_FOUND", type<WorkNotFoundData>()),
};

/** `search` procedure error declarations — mirrors the contract attachment. */
export const SEARCH_ERRORS = {
  UPSTREAM_UNAVAILABLE: declaration("UPSTREAM_UNAVAILABLE", type<UpstreamUnavailableData>()),
};

/** Construct a defined route-too-many-clusters oRPC error. */
export function routeTooManyClusters(clusterCount: number, maxClusters: number): ORPCError<"ROUTE_TOO_MANY_CLUSTERS", RouteTooManyClustersData> {
  const def = CATALOG_ERRORS.ROUTE_TOO_MANY_CLUSTERS;
  return new ORPCError("ROUTE_TOO_MANY_CLUSTERS", { defined: true, status: def.status, message: def.message, data: { cluster_count: clusterCount, max_clusters: maxClusters } });
}

/** Construct a defined route-too-many-points oRPC error. */
export function routeTooManyPoints(pointCount: number, maxPoints: number): ORPCError<"ROUTE_TOO_MANY_POINTS", RouteTooManyPointsData> {
  const def = CATALOG_ERRORS.ROUTE_TOO_MANY_POINTS;
  return new ORPCError("ROUTE_TOO_MANY_POINTS", { defined: true, status: def.status, message: def.message, data: { point_count: pointCount, max_points: maxPoints } });
}

/** Construct a defined work-not-found oRPC error. */
export function workNotFound(bangumiId: string): ORPCError<"WORK_NOT_FOUND", WorkNotFoundData> {
  const def = CATALOG_ERRORS.WORK_NOT_FOUND;
  return new ORPCError("WORK_NOT_FOUND", { defined: true, status: def.status, message: def.message, data: { bangumi_id: bangumiId } });
}

/** Construct a defined upstream-unavailable oRPC error. */
export function upstreamUnavailable(upstream: UpstreamSource, cause?: unknown): ORPCError<"UPSTREAM_UNAVAILABLE", UpstreamUnavailableData> {
  const def = CATALOG_ERRORS.UPSTREAM_UNAVAILABLE;
  return new ORPCError("UPSTREAM_UNAVAILABLE", { defined: true, status: def.status, message: def.message, data: { upstream }, cause });
}
