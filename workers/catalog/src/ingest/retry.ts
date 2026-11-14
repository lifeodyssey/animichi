/**
 * Bounded exponential-backoff retry for upstream HTTP fetches (S0-v2 D3).
 *
 * Retryability is classified by status code ONLY, per the repo convention:
 * 5xx, 408, 429, and transport errors retry with
 * backoff; every other error raises immediately. A `Retry-After` header
 * (delta-seconds or HTTP-date) overrides the backoff when present, capped at
 * `maxDelayMs`. Once attempts are exhausted the last transient failure is
 * rethrown, so callers keep their own error semantics — `upstream-call.ts`
 * converts it back to `UpstreamFetchError`.
 *
 * Time is bounded twice. Each attempt runs under `AbortSignal.timeout` of
 * `attemptTimeoutMs`, joined with the caller's signal by `AbortSignal.any`, so
 * a hung connection ends at the timeout and a caller's cancel reaches the
 * request in flight. The whole call has `deadlineMs` from its first attempt,
 * and a retry starts only when its wait plus one full attempt still end by
 * then — so the call settles by its deadline, and no retry is started that
 * could only be cut off (each one would spend another upstream request). Once
 * the caller's signal has aborted, no attempt starts and the caller's own
 * reason is rethrown: a cancel is never reported as an upstream failure.
 */

/** Knobs for {@link withRetry}; tests inject `sleep`/`jitterMs`/`now` to fake the clock. */
export interface RetryOptions {
  /** Total attempts (initial + retries), at least 1. Default 3; NaN or non-positive values fall back to the default. */
  attempts?: number;
  /** Exponential base of the first retry wait, in ms. Default 400. */
  baseDelayMs?: number;
  /** Ceiling for any single wait (incl. `Retry-After`), in ms. Default 10s. */
  maxDelayMs?: number;
  /** One attempt's timeout, in ms: an attempt still unanswered then is aborted. Default 12 s. */
  attemptTimeoutMs?: number;
  /** The whole call's deadline, in ms from its first attempt. Default 20 s. */
  deadlineMs?: number;
  /** Injectable sleeper — mock the clock in tests; default `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter over the backoff base — deterministic in tests. */
  jitterMs?: (baseMs: number) => number;
  /** Injectable clock the deadline is measured on — mock it in tests; default `Date.now`. */
  now?: () => number;
}

export const DEFAULT_RETRY_ATTEMPTS = 3;
export const DEFAULT_RETRY_BASE_MS = 400;
export const DEFAULT_RETRY_MAX_MS = 10_000;

/**
 * One attempt's timeout. The anitabi egress gives the upstream 10 s before it
 * answers with its own `upstream-timeout` refusal, which is final and never
 * retried (`apps/anitabi-egress/src/egress-service.ts`); 2 s more covers the
 * service's own checks and the hop to it, so that refusal arrives before this
 * side gives up and turns it into a retry that costs another request.
 */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 12_000;

/**
 * The whole call's deadline. The edge's catalog client abandons a request at
 * 25 s (`packages/agent/src/catalog-client.ts`), and each live request path
 * makes one upstream call; 20 s leaves the request 5 s for its database work
 * and its answer. A background ingest's two calls run side by side and also
 * end inside `waitUntil`'s 30 s.
 */
export const DEFAULT_RETRY_DEADLINE_MS = 20_000;

/** A transient upstream failure: {@link withRetry} retries these and nothing else. */
export class RetryableError extends Error {
  constructor(
    readonly status?: number,
    readonly retryAfterMs?: number,
    cause?: unknown,
  ) {
    super(retryableMessage(status), { cause });
    this.name = "RetryableError";
  }
}

/** 5xx, 408 (request timeout), 429 (rate limit) — other statuses raise immediately. */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/** `Retry-After` (delta-seconds or HTTP-date) as a wait in ms; null when unparseable. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const dateMs = Date.parse(trimmed);
  return Number.isNaN(dateMs) ? null : Math.max(dateMs - nowMs, 0);
}

/**
 * Re-run `attempt` on transient failures with backoff inside the call's
 * deadline; rethrow everything else. Each attempt is handed the signal it must
 * pass to its request: the caller's cancellation joined with its own timeout.
 */
export async function withRetry<T>(
  attempt: (signal: AbortSignal) => Promise<T> | T,
  opts: RetryOptions = {},
  caller: AbortSignal = new AbortController().signal,
): Promise<T> {
  const call = new RetryCall(resolveRetryConfig(opts), caller);
  for (let attemptNo = 0; ; attemptNo++) {
    try {
      return await attempt(call.attemptSignal());
    } catch (err) {
      await call.backoffOrRethrow(err, attemptNo);
    }
  }
}

/** One call's retry state: its policy, its caller's signal, and the deadline its first attempt set. */
class RetryCall {
  private readonly deadlineAt: number;

  constructor(private readonly cfg: Required<RetryOptions>, private readonly caller: AbortSignal) {
    this.deadlineAt = cfg.now() + cfg.deadlineMs;
  }

  /** The signal for the next attempt; none starts once the caller has cancelled. */
  attemptSignal(): AbortSignal {
    this.caller.throwIfAborted();
    return AbortSignal.any([this.caller, AbortSignal.timeout(this.cfg.attemptTimeoutMs)]);
  }

  /** Sleep the backoff, or rethrow: on a cancel, a final error, the last attempt, or no time left. */
  async backoffOrRethrow(err: unknown, attemptNo: number): Promise<void> {
    this.caller.throwIfAborted();
    if (!(err instanceof RetryableError) || attemptNo + 1 >= this.cfg.attempts) throw err;
    const waitMs = retryDelayMs(err.retryAfterMs, this.cfg.baseDelayMs * 2 ** attemptNo, this.cfg);
    if (!this.retryFits(waitMs)) throw err;
    await this.cfg.sleep(waitMs);
  }

  /** Whether a retry after `waitMs` would still end, timeout and all, by the deadline. */
  private retryFits(waitMs: number): boolean {
    return this.cfg.now() + waitMs + this.cfg.attemptTimeoutMs <= this.deadlineAt;
  }
}

function retryableMessage(status?: number): string {
  if (status === undefined) return "Transient upstream transport failure";
  return `Transient upstream failure (HTTP ${String(status)})`;
}

/** Resolved defaults; the `??` chains live here so `withRetry` stays flat. */
function resolveRetryConfig(opts: RetryOptions): Required<RetryOptions> {
  return {
    attempts: normalizeAttempts(opts.attempts),
    baseDelayMs: opts.baseDelayMs ?? DEFAULT_RETRY_BASE_MS,
    maxDelayMs: opts.maxDelayMs ?? DEFAULT_RETRY_MAX_MS,
    attemptTimeoutMs: opts.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS,
    deadlineMs: opts.deadlineMs ?? DEFAULT_RETRY_DEADLINE_MS,
    sleep: opts.sleep ?? defaultSleep,
    jitterMs: opts.jitterMs ?? fullJitter,
    now: opts.now ?? Date.now,
  };
}

/**
 * Positive-integer attempt caps only. NaN or a non-positive value would make
 * the exhaustion check `attemptNo + 1 >= attempts` never true and retry
 * forever, so anything invalid falls back to the default.
 */
function normalizeAttempts(attempts: number | undefined): number {
  if (attempts === undefined || !Number.isInteger(attempts) || attempts < 1) {
    return DEFAULT_RETRY_ATTEMPTS;
  }
  return attempts;
}

/** `Retry-After` wins over the jittered backoff; both are capped at `maxDelayMs`. */
function retryDelayMs(
  retryAfterMs: number | undefined,
  backoffMs: number,
  cfg: Required<RetryOptions>,
): number {
  const baseMs = retryAfterMs ?? cfg.jitterMs(backoffMs);
  return Math.min(baseMs, cfg.maxDelayMs);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Jitter in [0, baseMs) derived from the clock's sub-second phase. Not random and
 * not meant to be: it only desynchronizes peer retries, and at this deployment's
 * call volume a phase-derived spread does that without tripping crypto linters
 * (Sonar S2245 on Math.random, CodeQL biased-random on crypto modulo).
 */
function fullJitter(baseMs: number): number {
  return Date.now() % Math.max(1, baseMs);
}
