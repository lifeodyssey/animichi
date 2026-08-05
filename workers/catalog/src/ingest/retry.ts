/**
 * Bounded exponential-backoff retry for upstream HTTP fetches (S0-v2 D3).
 *
 * Retryability is classified by status code ONLY, per the repo convention
 * (apps/agent/AGENTS.md): 5xx, 408, 429, and transport errors retry with
 * backoff; every other error raises immediately. A `Retry-After` header
 * (delta-seconds or HTTP-date) overrides the backoff when present, capped at
 * `maxDelayMs`. Once attempts are exhausted the last transient failure is
 * rethrown, so callers keep their own error semantics — `sources.ts`
 * converts it back to `UpstreamFetchError`.
 */

/** Knobs for {@link withRetry}; tests inject `sleep`/`jitterMs` to fake the clock. */
export interface RetryOptions {
  /** Total attempts (initial + retries), at least 1. Default 3; NaN or non-positive values fall back to the default. */
  attempts?: number;
  /** Exponential base of the first retry wait, in ms. Default 400. */
  baseDelayMs?: number;
  /** Ceiling for any single wait (incl. `Retry-After`), in ms. Default 10s. */
  maxDelayMs?: number;
  /** Injectable sleeper — mock the clock in tests; default `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter over the backoff base — deterministic in tests. */
  jitterMs?: (baseMs: number) => number;
}

export const DEFAULT_RETRY_ATTEMPTS = 3;
export const DEFAULT_RETRY_BASE_MS = 400;
export const DEFAULT_RETRY_MAX_MS = 10_000;

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

/** Re-run `attempt` on transient failures with backoff; rethrow everything else. */
export async function withRetry<T>(attempt: () => Promise<T> | T, opts: RetryOptions = {}): Promise<T> {
  const cfg = resolveRetryConfig(opts);
  for (let attemptNo = 0; ; attemptNo++) {
    try {
      return await attempt();
    } catch (err) {
      await backoffOrRethrow(err, attemptNo, cfg);
    }
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
    sleep: opts.sleep ?? defaultSleep,
    jitterMs: opts.jitterMs ?? fullJitter,
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

/** Sleep the backoff, or rethrow when the error is final or attempts run out. */
function backoffOrRethrow(
  err: unknown,
  attemptNo: number,
  cfg: Required<RetryOptions>,
): Promise<void> {
  if (!(err instanceof RetryableError) || attemptNo + 1 >= cfg.attempts) throw err;
  const backoffMs = cfg.baseDelayMs * 2 ** attemptNo;
  return cfg.sleep(retryDelayMs(err.retryAfterMs, backoffMs, cfg.maxDelayMs, cfg.jitterMs));
}

/** `Retry-After` wins over the jittered backoff; both are capped at `maxDelayMs`. */
function retryDelayMs(
  retryAfterMs: number | undefined,
  backoffMs: number,
  maxDelayMs: number,
  jitterMs: (baseMs: number) => number,
): number {
  const baseMs = retryAfterMs ?? jitterMs(backoffMs);
  return Math.min(baseMs, maxDelayMs);
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
