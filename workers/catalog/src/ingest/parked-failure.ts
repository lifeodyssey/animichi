/**
 * How a failed ingest parks behind the negative cache: the shape of the TTL
 * policy `IngestBangumi` (`./ingest-bangumi`) is built with, and the
 * `ingest_jobs` row one classified failure parks as — its kind, the text a
 * person reads, the stage it stopped at, and how long the work stays
 * unclaimable. What kind a failure is, and what its row tells the person
 * reading it, is `./ingest-failure`'s taxonomy; the TTL values themselves are
 * `DEFAULT_INGEST_TTL` in `./ingest-bangumi`.
 */
import { failedStage, IngestErrorCode, operatorRecord, type IngestFailure } from "./ingest-failure";
import type { FailureOptions } from "./jobs";

/** Negative-cache TTL policy for `IngestBangumi`. */
export interface IngestTtl {
  failureSeconds: number;
  refusalSeconds: number;
  emptySeconds: number;
  egressSeconds: number;
}

/** The row `failure` parks as under `ttl`. */
export function parkedFailure(ttl: IngestTtl, failure: IngestFailure): FailureOptions {
  return {
    errorCode: failure.code, ttlSeconds: parkedSeconds(ttl, failure.code),
    error: operatorRecord(failure), stage: failedStage(failure),
  };
}

/** How long each kind parks before the work is claimable again. */
function parkedSeconds(ttl: IngestTtl, code: IngestErrorCode): number {
  if (code === IngestErrorCode.NotFound) return ttl.emptySeconds;
  if (code === IngestErrorCode.UpstreamRefused) return ttl.refusalSeconds;
  if (code === IngestErrorCode.EgressRefused) return ttl.egressSeconds;
  return ttl.failureSeconds;
}
