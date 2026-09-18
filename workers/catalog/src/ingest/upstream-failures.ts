/**
 * How an upstream source fails, as the ingest pipeline tells the kinds apart
 * (#1784). A 404 is "no data", a refusal is "not for you", and every other
 * failure — retries exhausted, a transport error, an unreadable body — is the
 * upstream failing. Each kind asks a different person to do a different thing,
 * so each is its own type rather than a status code folded into one message.
 */

/** Upstream identity retained on transport failures for typed boundary mapping. */
export type UpstreamName = "anitabi" | "bangumi";

/** A 404 from an upstream source: the resource has no data, NOT a transient
 * outage. Callers that treat "no data" as an empty result catch THIS
 * specifically; every other failure stays a generic (retryable) error. */
export class UpstreamNotFoundError extends Error {
  constructor(readonly url: string) {
    super(`Upstream resource not found (404): ${url}`);
    this.name = "UpstreamNotFoundError";
  }
}

/** A transport or non-2xx failure distinct from a real upstream 404. */
export class UpstreamFetchError extends Error {
  constructor(readonly url: string, readonly upstream: UpstreamName, cause?: unknown) {
    super(`Upstream fetch failed: ${url}`, { cause });
    this.name = "UpstreamFetchError";
  }
}

/** The upstream understood the request and refuses this client: an admission
 * decision (bot protection, a revoked or missing grant), not an outage, so
 * asking again does not change the answer. A subclass of the fetch failure so
 * every caller that maps upstream failures still sees one. */
export class UpstreamRefusedError extends UpstreamFetchError {
  constructor(url: string, upstream: UpstreamName) {
    super(url, upstream);
    this.message = `Upstream refused this client: ${url}`;
    this.name = "UpstreamRefusedError";
  }
}

/** The statuses by which HTTP says "not for you": 401 (unauthenticated) and 403 (forbidden). */
const REFUSAL_STATUSES: ReadonlySet<number> = new Set([401, 403]);

/** A non-2xx answer that was not retried: a refusal, or any other fetch failure. */
export function statusFailure(url: string, status: number, upstream: UpstreamName): UpstreamFetchError {
  const located = `${url} (${String(status)})`;
  if (REFUSAL_STATUSES.has(status)) return new UpstreamRefusedError(located, upstream);
  return new UpstreamFetchError(located, upstream);
}
