/**
 * Every upstream request the ingest path can make, enumerated (#1792).
 *
 * The URL is built HERE and nowhere else on this side, from the request itself:
 * `fetchJson` takes one of these and never a string, so a request outside this
 * union is a type error rather than a runtime rejection. Adding a destination
 * means adding a member here, in review, next to the two tests that pin the
 * set — there is no parameter, header or path segment anywhere that names one.
 *
 * The anitabi members do not carry an origin: that path goes through the egress
 * service, whose address is a constant in ./anitabi-egress and whose own
 * permitted surface is the capture in `apps/anitabi-egress/anitabi-api-surface.json`.
 * Bangumi is fetched directly; it is not behind the egress and not this card's
 * control, so its base stays the injectable it always was.
 */
import { ANITABI_EGRESS_BASE_URL, egressPathFor, type AnitabiOperation } from "./anitabi-egress";
import type { UpstreamName } from "./upstream-failures";

/** The Bangumi v0 origin (not behind the egress; still the injectable test seam). */
export const BANGUMI_BASE = "https://api.bgm.tv";

/** A Bangumi v0 request, always for one subject or one bounded search page. */
export type BangumiRequest =
  | { readonly upstream: "bangumi"; readonly operation: "subject"; readonly bangumiId: string }
  | { readonly upstream: "bangumi"; readonly operation: "calendar" }
  | { readonly upstream: "bangumi"; readonly operation: "search-subjects"; readonly limit: number };

/** An anitabi request: one of the egress service's operations, for one bangumi id. */
export interface AnitabiRequest {
  readonly upstream: "anitabi";
  readonly operation: AnitabiOperation;
  readonly bangumiId: string;
}

/** Everything the catalog can ask an upstream for. */
export type UpstreamRequest = AnitabiRequest | BangumiRequest;

/** The upstream a request belongs to, for the failure taxonomy. */
export function upstreamNameOf(request: UpstreamRequest): UpstreamName {
  return request.upstream;
}

/** The URL for a request: the anitabi one through the egress, the other directly. */
export function upstreamUrlFor(request: UpstreamRequest, bangumiBaseUrl: string): string {
  return request.upstream === "anitabi" ? anitabiUrlFor(request) : bangumiUrlFor(request, bangumiBaseUrl);
}

/**
 * A validated bangumi id: decimal digits, positive, and inside the safe integer
 * range. This is the one free variable on the anitabi path — everything else
 * about the destination is enumerated — so it is checked before it can reach a
 * URL, and it is the same check for either upstream.
 */
export function validateBangumiId(raw: string): string {
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error(`Invalid bangumi_id: "${raw}" — must be a positive integer`);
  }
  return raw;
}

/** The egress service's URL for its operation — the caller never names the path. */
function anitabiUrlFor(request: AnitabiRequest): string {
  return `${ANITABI_EGRESS_BASE_URL}${egressPathFor(request.operation, validateBangumiId(request.bangumiId))}`;
}

function bangumiUrlFor(request: BangumiRequest, base: string): string {
  switch (request.operation) {
    case "subject":
      return `${base}/v0/subjects/${validateBangumiId(request.bangumiId)}`;
    case "calendar":
      return `${base}/calendar`;
    case "search-subjects":
      return `${base}/v0/search/subjects?limit=${String(searchLimit(request.limit))}&offset=0`;
  }
}

/** Validate the adapter's internal result cap before interpolating it into the URL. */
function searchLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Bangumi search limit must be a positive integer");
  return limit;
}
