/**
 * The read-only catalog port the four model tools call, and the one failure
 * they are allowed to degrade into.
 *
 * Port of `apps/agent/src/animichi/clients/catalog_client.py`'s
 * `CatalogClientProtocol`. The wire types are the contract's — imported as
 * types only, so no zod runtime reaches this Worker (`workers/catalog` keeps
 * the same discipline in `src/types.ts`).
 */

import type {
  GeocodeCandidate,
  Itinerary,
  LatLng,
  Pacing,
  Point,
  ResolveOutcome,
  SearchResult,
} from "@animichi/contract";

/**
 * The catalog could not answer. Python degraded `(APIError, OSError,
 * RuntimeError)` into one `upstream_unavailable` outcome
 * (`catalog_failures.py`); this is that set, named.
 *
 * `detail` carries the upstream text for the server log ONLY. SD-19: the
 * failure text never reaches the model, so tools log it and return the
 * outcome, never the message (`catalog_tools.py::_log_upstream_down`).
 */
export class CatalogUnavailableError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super("the catalog could not answer");
    this.name = "CatalogUnavailableError";
    this.detail = detail.slice(0, 200);
  }
}

/** Everything the catalog tools ask the catalog for. Read-only by construction. */
export interface CatalogClient {
  /** Free text to a deterministic anime identity. */
  resolve(query: string, signal?: AbortSignal): Promise<ResolveOutcome>;
  /** Published points for an already-resolved work. */
  pointsByBangumiId(bangumiId: string, signal?: AbortSignal): Promise<SearchResult>;
  /** Points within `radiusM` of a coordinate. */
  nearby(around: LatLng, radiusM: number, signal?: AbortSignal): Promise<Point[]>;
  /** Place name to gazetteer candidates. */
  geocode(query: string, limit: number, signal?: AbortSignal): Promise<GeocodeCandidate[]>;
  /** An ordered, timed route over the given points. */
  planItinerary(pointIds: string[], pacing: Pacing | undefined, signal?: AbortSignal): Promise<Itinerary>;
}
