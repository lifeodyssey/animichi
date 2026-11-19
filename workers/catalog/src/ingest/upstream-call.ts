/**
 * One upstream call: an enumerated {@link UpstreamRequest} sent through
 * `withRetry`, its status guarded, its JSON body decoded.
 *
 * Every attempt's request carries the signal `withRetry` hands it — the
 * caller's cancellation joined with the attempt timeout — so a hung connection
 * ends at the timeout and a caller's cancel reaches the request in flight. That
 * signal also bounds the body read, because aborting a fetch errors its body
 * stream. A failure the caller's own cancel caused is rethrown as the caller's
 * reason, never as an {@link UpstreamFetchError}: a cancel is not the
 * upstream failing.
 */
import { ANITABI_USER_AGENT } from "@animichi/contract/anitabi-display";
import { EgressRefusedError } from "./egress-refusal";
import { isRetryableStatus, parseRetryAfter, RetryableError, withRetry } from "./retry";
import type { FetchLike, SourceConfig } from "./sources";
import { statusFailure, UpstreamFetchError, UpstreamNotFoundError, type UpstreamName } from "./upstream-failures";
import { BANGUMI_BASE, upstreamNameOf, upstreamUrlFor, type UpstreamRequest } from "./upstream-requests";

type FetchInit = Parameters<FetchLike>[1];
type FetchResponse = Awaited<ReturnType<FetchLike>>;

/** GET + JSON-decode with retry + status guarding; throws on a non-2xx response. */
export async function fetchJson(request: UpstreamRequest, cfg: SourceConfig = {}): Promise<unknown> {
  const url = upstreamUrlFor(request, cfg.bangumiBaseUrl ?? BANGUMI_BASE);
  const res = await fetchWithRetry(url, upstreamNameOf(request), cfg, { headers: { "User-Agent": ANITABI_USER_AGENT } });
  if (res.status === 404) throw new UpstreamNotFoundError(url);
  if (!res.ok) throw statusFailure(url, res.status, upstreamNameOf(request));
  return decodeJson(res, url, upstreamNameOf(request), cfg.signal);
}

/** POST a JSON body + JSON-decode with retry + status guarding; throws on a non-2xx response. */
export async function postJson(request: UpstreamRequest, body: string, cfg: SourceConfig = {}): Promise<unknown> {
  const url = upstreamUrlFor(request, cfg.bangumiBaseUrl ?? BANGUMI_BASE);
  const upstream = upstreamNameOf(request);
  const headers = { "User-Agent": ANITABI_USER_AGENT, "Content-Type": "application/json" };
  const res = await fetchWithRetry(url, upstream, cfg, { method: "POST", headers, body });
  if (!res.ok) throw statusFailure(url, res.status, upstream);
  return decodeJson(res, url, upstream, cfg.signal);
}

/** Fetch with retry on transient failures; exhaustion rethrows as UpstreamFetchError. */
async function fetchWithRetry(url: string, upstream: UpstreamName, cfg: SourceConfig, init: FetchInit): Promise<FetchResponse> {
  const doFetch = cfg.fetchImpl ?? fetch;
  try {
    return await withRetry((signal) => attemptFetch(doFetch, url, { ...init, signal }), cfg.retry, cfg.signal);
  } catch (err) {
    return upstreamError(url, upstream, err);
  }
}

function upstreamError(url: string, upstream: UpstreamName, err: unknown): never {
  if (!(err instanceof RetryableError)) throw err;
  const suffix = err.status !== undefined ? ` (${String(err.status)})` : "";
  throw new UpstreamFetchError(`${url}${suffix}`, upstream, err.cause);
}

/** One attempt: transient statuses/transport errors signal a retry; others pass through. */
async function attemptFetch(doFetch: FetchLike, url: string, init: FetchInit): Promise<FetchResponse> {
  try {
    return await fetchOnce(doFetch, url, init);
  } catch (err) {
    // An egress refusal is OUR service refusing — final, never retried
    // (the ceiling clears on its own within the hour); it must not be
    // mistaken for a transient upstream fault (#1792).
    if (err instanceof EgressRefusedError) throw err;
    throw err instanceof RetryableError ? err : new RetryableError(undefined, undefined, err);
  }
}

async function fetchOnce(doFetch: FetchLike, url: string, init: FetchInit): Promise<FetchResponse> {
  const res = await doFetch(url, init);
  checkRetryable(res);
  return res;
}

function checkRetryable(res: FetchResponse): void {
  if (!isRetryableStatus(res.status)) return;
  const delay = parseRetryAfter(res.headers?.get("retry-after") ?? null, Date.now()) ?? undefined;
  throw new RetryableError(res.status, delay);
}

/** Convert malformed or cut-off bodies into source-aware failures; a caller's cancel stays the caller's. */
async function decodeJson(res: FetchResponse, url: string, upstream: UpstreamName, caller?: AbortSignal): Promise<unknown> {
  try {
    return await res.json();
  } catch (err) {
    caller?.throwIfAborted();
    throw new UpstreamFetchError(url, upstream, err);
  }
}
