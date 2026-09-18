/**
 * The ingest failure taxonomy (#1784): which kind of failure a parked
 * `ingest_jobs` row records, and what the person reading it should do.
 *
 * Four kinds, one per distinct response:
 *   - `not_found`        — the upstream has no data for the work. Nobody acts.
 *   - `upstream_refused` — the upstream refused this client (401/403). Time does
 *                          not fix it; a person must establish access.
 *   - `upstream_fault`   — the upstream failed (5xx/408/429 past the in-request
 *                          retries, a transport error, an unreadable body). It
 *                          is retried on its own; act only if it persists.
 *   - `ingest_error`     — our pipeline could not use what came back (a payload
 *                          shape it does not know, an enrich/publish failure).
 *                          The fix is in our code.
 *
 * The persisted `error` text is the cause followed by that action, so the row
 * alone answers "what kind, and what now".
 */
import {
  UpstreamFetchError,
  UpstreamNotFoundError,
  UpstreamRefusedError,
  type UpstreamName,
} from "./upstream-failures";

export type IngestErrorCode = (typeof IngestErrorCode)[keyof typeof IngestErrorCode];

export const IngestErrorCode = {
  NotFound: "not_found",
  UpstreamRefused: "upstream_refused",
  UpstreamFault: "upstream_fault",
  IngestError: "ingest_error",
} as const;

const OPERATOR_ACTION: Record<IngestErrorCode, string> = {
  not_found: "the upstream has no data for this work; rechecked weekly, nothing to do",
  upstream_refused:
    "the upstream is refusing this client; retrying will not help — establish sanctioned access "
    + "(a key, an agreement or another source), then clear negative_cached_until on the refused rows",
  upstream_fault: "the upstream failed; it is retried automatically — act only if it persists",
  ingest_error: "our pipeline could not use what came back; read the cause and fix the code",
};

/** One classified failure: its kind, the cause, and the upstream it came from. */
export interface IngestFailure {
  readonly code: IngestErrorCode;
  readonly cause: string;
  readonly upstream: UpstreamName | null;
}

/** Classify a pipeline failure; the refusal is checked before its parent fault type. */
export function classifyIngestFailure(err: unknown): IngestFailure {
  if (err instanceof UpstreamNotFoundError) return { code: IngestErrorCode.NotFound, cause: err.message, upstream: null };
  if (err instanceof UpstreamRefusedError) return upstreamFailure(IngestErrorCode.UpstreamRefused, err);
  if (err instanceof UpstreamFetchError) return upstreamFailure(IngestErrorCode.UpstreamFault, err);
  return { code: IngestErrorCode.IngestError, cause: causeOf(err), upstream: null };
}

/** The row text a person reads: the cause, then what to do about this kind. */
export function operatorRecord(failure: IngestFailure): string {
  return `${failure.cause} — ${OPERATOR_ACTION[failure.code]}`;
}

/** The pipeline stage the failure stopped at, when it was an upstream fetch. */
export function failedStage(failure: IngestFailure): string | undefined {
  return failure.upstream === null ? undefined : fetchStage(failure.upstream);
}

/** The `ingest_jobs.stage` a failed fetch from `upstream` records, e.g. `fetch:anitabi`. */
export function fetchStage(upstream: UpstreamName): string {
  return `fetch:${upstream}`;
}

function upstreamFailure(code: IngestErrorCode, err: UpstreamFetchError): IngestFailure {
  return { code, cause: err.message, upstream: err.upstream };
}

function causeOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
