/**
 * The production `CatalogClient`: the private `CATALOG` service binding.
 *
 * The catalog is our own infrastructure, so spec Appendix D forbids reaching it
 * by URL — this is the same in-datacenter hop `gateway/forward.ts` already
 * makes, and the paths are the ones `gateway/catalog-policy.ts` allows the
 * container to name. The binding carries no identity: `/catalog/*` is served by
 * the oRPC handler, which reads no `X-User-*` header (verified against
 * `workers/catalog/src/index.ts`), and the edge alone decides who may call it.
 *
 * Every failure it can degrade from — transport, timeout, non-2xx, unparseable
 * body — leaves here as `CatalogUnavailableError`, which is Python's
 * `CATALOG_FAILURES` tuple expressed as one type.
 *
 * The `expect*` guards below are why the assertions in this file are honest:
 * Python re-validated every catalog body with pydantic, and the edge cannot,
 * since the contract's zod does not load here (spec §二 keeps zod in
 * `packages/contract`). So each guard checks the ONE field the tools branch on
 * before asserting the contract type — a body the tools would misread fails as
 * `upstream_unavailable` instead of reaching the model, and no schema is copied
 * to achieve it. This is the only place in the tools where a cast appears.
 */

import { CatalogUnavailableError } from "./catalog-client.ts";
import type { CatalogClient } from "./catalog-client.ts";
import {
  CATALOG_MAX_ATTEMPTS,
  CATALOG_REQUEST_TIMEOUT_MS,
  CATALOG_TOTAL_TIMEOUT_MS,
} from "./catalog-timeouts.ts";
import type {
  GeocodeCandidate,
  Itinerary,
  LatLng,
  Pacing,
  Point,
  ResolveOutcome,
  SearchResult,
} from "@animichi/contract";

/** Statuses worth another attempt (`catalog_client.py::_is_retryable_response`). */
const TRANSIENT_STATUSES = new Set([408, 429]);

/** The one thing this adapter needs from `Env`: the private binding. */
export interface CatalogBinding {
  fetch: (request: Request) => Promise<Response>;
}

/** How long to wait before attempt `attempt`, capped as tenacity capped it. */
export function retryDelayMs(attempt: number): number {
  return Math.min(2 ** (attempt - 1) * 1000, 30_000);
}

/** True when the response deserves another attempt rather than a failure. */
function isTransient(status: number): boolean {
  return status >= 500 || TRANSIENT_STATUSES.has(status);
}

/** The oRPC request for one catalog procedure. */
function catalogRequest(procedure: string, body: object): Request {
  return new Request(`https://catalog.internal/catalog/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
}

/** A signal that aborts when the caller's does, or when `ms` elapse. */
function deadline(ms: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** One attempt. Anything that is not a 2xx JSON body throws. */
async function attempt(binding: CatalogBinding, procedure: string, body: object, signal: AbortSignal): Promise<Response> {
  const request = new Request(catalogRequest(procedure, body), {
    signal: deadline(CATALOG_REQUEST_TIMEOUT_MS, signal),
  });
  return binding.fetch(request);
}

/** Whether the loop may try again: budget left, and the caller still wants it. */
function mayRetry(attemptNumber: number, signal: AbortSignal): boolean {
  return attemptNumber < CATALOG_MAX_ATTEMPTS && !signal.aborted;
}

/** The failure text kept for the server log, never for the model (SD-19). */
function failureDetail(procedure: string, reason: string): string {
  return `${procedure}: ${reason}`;
}

/**
 * Call one catalog procedure, retrying transient failures inside the total
 * budget. The caller's abort signal wins immediately — an aborted turn must
 * not sit in a backoff — and is re-thrown rather than degraded, because pi
 * treats abort as the turn ending, not as a tool result.
 */
async function callCatalog(
  binding: CatalogBinding,
  procedure: string,
  body: object,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<unknown> {
  const total = deadline(CATALOG_TOTAL_TIMEOUT_MS, signal);
  const last = await spendAttempts(binding, procedure, body, sleep, total, signal);
  if (last.parsed !== undefined) return last.parsed;
  signal?.throwIfAborted();
  throw new CatalogUnavailableError(failureDetail(procedure, last.reason));
}

/** Spend the attempt budget, stopping at the first answer or hard failure. */
async function spendAttempts(
  binding: CatalogBinding,
  procedure: string,
  body: object,
  sleep: (ms: number) => Promise<void>,
  total: AbortSignal,
  signal?: AbortSignal,
): Promise<AttemptOutcome> {
  let outcome: AttemptOutcome = { reason: "no attempt was made", transient: false };
  for (let number = 1; number <= CATALOG_MAX_ATTEMPTS; number += 1) {
    signal?.throwIfAborted();
    outcome = await attemptOutcome(binding, procedure, body, total);
    if (outcome.parsed !== undefined || !outcome.transient || !mayRetry(number, total)) break;
    await backoff(sleep, retryDelayMs(number), signal);
  }
  return outcome;
}

/** Resolves the moment `signal` aborts, and is dropped once `spent` says the
 * backoff finished first — nothing should outlive the wait it belongs to. */
function abortWaiter(signal: AbortSignal, spent: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => { resolve(); }, { once: true, signal: spent });
  });
}

/** Wait out one backoff, but never past the caller's abort: an aborted turn
 * must leave here at once, with the abort, not one delay from now. */
async function backoff(sleep: (ms: number) => Promise<void>, ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  signal.throwIfAborted();
  const spent = new AbortController();
  await Promise.race([sleep(ms).then(() => { spent.abort(); }), abortWaiter(signal, spent.signal)]);
  signal.throwIfAborted();
}

/** One attempt's result: a parsed body, or why it did not produce one. */
interface AttemptOutcome {
  parsed?: unknown;
  reason: string;
  transient: boolean;
}

/** Run one attempt and classify it without throwing. */
async function attemptOutcome(
  binding: CatalogBinding,
  procedure: string,
  body: object,
  signal: AbortSignal,
): Promise<AttemptOutcome> {
  try {
    const response = await attempt(binding, procedure, body, signal);
    if (!response.ok) return { reason: `status ${String(response.status)}`, transient: isTransient(response.status) };
    return { parsed: await response.json(), reason: "", transient: false };
  } catch (error) {
    return { reason: String(error), transient: true };
  }
}

/** The catalog's answer as a JSON object, or a failure. */
function objectBody(payload: unknown, procedure: string): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload as Record<string, unknown>;
  throw new CatalogUnavailableError(failureDetail(procedure, "expected a JSON object"));
}

/** Read a JSON array field the catalog promised, or fail the call. */
function arrayField(payload: unknown, field: string, procedure: string): unknown[] {
  const value = objectBody(payload, procedure)[field];
  if (Array.isArray(value)) return value;
  throw new CatalogUnavailableError(failureDetail(procedure, `expected '${field}' to be a JSON array`));
}

const RESOLVE_OUTCOMES = ["resolved", "needs_disambiguation", "not_found", "upstream_unavailable"];

/** Check the outcome the tools branch on before trusting the rest. */
function expectResolveOutcome(payload: unknown): ResolveOutcome {
  const outcome = objectBody(payload, "resolve").outcome;
  if (typeof outcome === "string" && RESOLVE_OUTCOMES.includes(outcome)) return payload as ResolveOutcome;
  throw new CatalogUnavailableError(failureDetail("resolve", `unknown outcome ${String(outcome)}`));
}

/** Check that a search answer carries the rows the tools read. */
function expectSearchResult(payload: unknown): SearchResult {
  arrayField(payload, "rows", "points-by-bangumi-id");
  return payload as SearchResult;
}

/** The rows a nearby answer wraps. */
function expectNearbyRows(payload: unknown): Point[] {
  return arrayField(payload, "rows", "nearby") as Point[];
}

/** The candidates a geocode answer wraps. */
function expectGeocodeCandidates(payload: unknown): GeocodeCandidate[] {
  return arrayField(payload, "candidates", "geocode") as GeocodeCandidate[];
}

/** The nearby request body: the catalog's own `NearbyInput` field names. */
function nearbyBody(around: LatLng, radiusM: number): object {
  return { lat: around.lat, lng: around.lng, radius_m: radiusM };
}

/** The route request body, which carries pacing only when the model named one. */
function itineraryBody(pointIds: string[], pacing: Pacing | undefined): object {
  return pacing ? { point_ids: pointIds, pacing } : { point_ids: pointIds };
}

/** Check that a route answer carries the counts and timings the tools read. */
function expectItinerary(payload: unknown): Itinerary {
  const body = objectBody(payload, "itinerary");
  arrayField(payload, "ordered_points", "itinerary");
  const routed = typeof body.point_count === "number" && typeof body.timed_itinerary === "object";
  if (routed && body.timed_itinerary !== null) return payload as Itinerary;
  throw new CatalogUnavailableError(failureDetail("itinerary", "missing point_count or timed_itinerary"));
}

/**
 * Build the production catalog client over a service binding.
 *
 * `sleep` is injected for the same reason `gateway/forward.ts` injects it: the
 * retry backoff is real time, and a test must be able to drive it without
 * waiting for it.
 */
export function serviceBindingCatalog(
  binding: CatalogBinding,
  sleep: (ms: number) => Promise<void>,
): CatalogClient {
  const call = (procedure: string, body: object, signal?: AbortSignal): Promise<unknown> =>
    callCatalog(binding, procedure, body, sleep, signal);
  return {
    resolve: async (query, signal) => expectResolveOutcome(await call("resolve", { query }, signal)),
    pointsByBangumiId: async (bangumiId, signal) => expectSearchResult(await call("points-by-bangumi-id", { bangumi_id: bangumiId }, signal)),
    nearby: async (around, radiusM, signal) => expectNearbyRows(await call("nearby", nearbyBody(around, radiusM), signal)),
    geocode: async (query, limit, signal) => expectGeocodeCandidates(await call("geocode", { query, limit }, signal)),
    planItinerary: async (pointIds, pacing, signal) => expectItinerary(await call("itinerary", itineraryBody(pointIds, pacing), signal)),
  };
}
