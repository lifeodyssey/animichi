/// <reference types="@cloudflare/workers-types" />

/**
 * Bounded, retrying container fetch (issue #1220 / system-health-audit §2.1).
 *
 * Two independent concerns compose here: a startup retry for the container's
 * own "not running" cold-start signal (issue #694 — moved here from
 * `gateway/request.ts` so `gateway/forward.ts`'s `/v1` forwarding can reuse
 * it without a `forward.ts` <-> `request.ts` import cycle), and a
 * head-of-response timeout that bounds only the wait for the container's
 * fetch to settle with a response object — never the SSE body that follows.
 */

// ── Startup retry (issue #694) ──────────────────────────────────────────

/** While a container is still starting, its fetch answers a 500 whose body
 * carries this marker (or throws an error that does). Retry briefly instead
 * of failing the caller, then pass the final failure through unchanged. */
const NOT_RUNNING_MARKER = "The container is not running";
const NOT_RUNNING_RETRIES = 3;

/** Backoff before the 2nd and 3rd attempts: 400ms then 800ms (issue #694). */
function startupBackoffMs(attempt: number): number {
  return attempt === 1 ? 400 : 800;
}

function isNotRunningError(error: unknown): error is Error {
  return error instanceof Error && error.message.includes(NOT_RUNNING_MARKER);
}

async function isNotRunningResponse(response: Response): Promise<boolean> {
  if (response.status !== 500) return false;
  return (await response.clone().text()).includes(NOT_RUNNING_MARKER);
}

function coldStartFailure(error: unknown): { ok: false; failure: Error } {
  if (isNotRunningError(error)) return { ok: false, failure: error };
  throw error;
}

/** One container fetch attempt: the response to return, or the failure to
 * retry (re-thrown immediately when it is not a cold-start failure). */
type FetchAttempt = { ok: true; response: Response } | { ok: false; failure: Response | Error };

async function containerFetchAttempt(
  fetchFn: (request: Request) => Promise<Response>, request: Request,
): Promise<FetchAttempt> {
  try {
    const response = await fetchFn(request);
    return (await isNotRunningResponse(response)) ? { ok: false, failure: response } : { ok: true, response };
  } catch (error) {
    return coldStartFailure(error);
  }
}

function finalFailureResponse(failure: Response | Error): Response {
  if (failure instanceof Error) throw failure;
  return failure;
}

async function fetchAttempt(
  fetchFn: (request: Request) => Promise<Response>,
  request: Request,
  attempt: number,
  sleep: (ms: number) => Promise<void>,
): Promise<FetchAttempt> {
  if (attempt > 0) await sleep(startupBackoffMs(attempt));
  return containerFetchAttempt(fetchFn, request);
}

/** Retries a container fetch through its cold-start "not running" window; any
 * other failure (a real 500, a non-cold-start error) passes straight through
 * on the first attempt. Shared by `/healthz` (`gateway/request.ts`) and every
 * `/v1` forward (`gateway/forward.ts`) — the container's cold start does not
 * care which route woke it. */
export async function fetchContainerWithStartupRetry(
  fetchFn: (request: Request) => Promise<Response>, request: Request, sleep: (ms: number) => Promise<void>,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const outcome = await fetchAttempt(fetchFn, request.clone(), attempt, sleep);
    if (outcome.ok || attempt === NOT_RUNNING_RETRIES - 1) {
      return outcome.ok ? outcome.response : finalFailureResponse(outcome.failure);
    }
  }
}

// ── Head-of-response timeout (issue #1220) ──────────────────────────────

/**
 * Bounds the container fetch's head-of-response wait: the measured cold start
 * is up to ~24.5s (system-health-audit §2.1) and a chat turn adds the agent's
 * first-model-call latency on top of that, so 60s covers both with headroom.
 */
export const CONTAINER_FETCH_HEAD_TIMEOUT_MS = 60_000;

function headTimeoutResponse(): Response {
  return Response.json(
    { error: { code: "container_timeout", message: "The container did not respond in time." } },
    { status: 504 },
  );
}

/** Arms the wall-clock deadline: a plain `setTimeout`, deliberately not
 * `AbortSignal.timeout` (see `fetchContainerWithHeadTimeout`'s doc) and
 * deliberately not the injectable `sleep` used for startup backoff — this is
 * a hard outer bound, not a pacing knob a caller should be able to fast-forward
 * away with a test double. Returns the timed-out response promise plus a
 * `cancel` to disarm it once the real fetch has already settled. */
function armHeadTimeout(
  controller: AbortController, timeoutMs: number,
): { timedOut: Promise<Response>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<Response>((resolve) => {
    timer = setTimeout(() => {
      // Resolve before aborting: `controller.abort()` dispatches its event
      // synchronously, and a real `fetch` rejects its promise from that same
      // synchronous abort-listener call — so aborting first would schedule
      // that rejection microtask ahead of this resolution, making
      // `Promise.race` in `fetchContainerWithHeadTimeout` reject instead of
      // returning the 504 (see the "abort handler rejects synchronously"
      // regression test in `container-fetch-timeout.test.ts`).
      resolve(headTimeoutResponse());
      controller.abort();
    }, timeoutMs);
  });
  return { timedOut, cancel: () => { clearTimeout(timer); } };
}

/**
 * Bounds only the time until the container's fetch settles with a response
 * object — its headers — never the streamed body that follows. A signal that
 * stayed armed for the whole call would abort an in-flight SSE stream too
 * (Workers' fetch `signal` cancels a streaming body, not just connection
 * setup), cutting a live chat answer mid-turn — so this races the fetch
 * against a plain timer instead of an end-to-end `AbortSignal.timeout`
 * (contrast `protect/turnstile.ts`'s siteverify call, which has no streaming
 * body to protect). If the timer wins, the container fetch is aborted and a
 * 504 is returned; once the fetch settles, the timer is cleared and the
 * response — headers and body — is returned with no further deadline; SSE
 * keeps itself alive with the agent's own pings.
 *
 * Exported (not just used via `fetchContainerResilient`) so the race itself
 * is directly testable: `fetchContainerResilient` wraps `fetchFn` through
 * `fetchContainerWithStartupRetry`'s own async layers, whose extra microtask
 * ticks on the rejection path make `armHeadTimeout`'s resolve/abort order
 * unobservable there — only a fetch raced against the timeout with no such
 * wrapping (as here) is fast enough on rejection for the order to matter.
 */
export function fetchContainerWithHeadTimeout(
  fetchFn: (request: Request) => Promise<Response>, request: Request, timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const fetchPromise = fetchFn(new Request(request, { signal: controller.signal }));
  fetchPromise.catch(() => undefined); // a late abort-rejection once the timer wins must never be unhandled
  const { timedOut, cancel } = armHeadTimeout(controller, timeoutMs);
  return Promise.race([fetchPromise, timedOut]).finally(cancel);
}

/**
 * The single resilient container fetch: the startup retry runs inside the
 * head-of-response timeout, so its 400/800ms backoffs (issue #694) spend from
 * the same budget rather than escaping it, and a container that never answers
 * at all — not even with a "not running" signal — still gets cut off and
 * turned into a 504 instead of hanging the caller forever.
 */
export function fetchContainerResilient(
  fetchFn: (request: Request) => Promise<Response>,
  request: Request,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number = CONTAINER_FETCH_HEAD_TIMEOUT_MS,
): Promise<Response> {
  return fetchContainerWithHeadTimeout(
    (signalled) => fetchContainerWithStartupRetry(fetchFn, signalled, sleep),
    request,
    timeoutMs,
  );
}
