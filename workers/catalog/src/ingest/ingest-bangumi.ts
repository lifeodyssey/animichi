/**
 * IngestBangumi — the application use case that owns the complete Bangumi
 * ingest lifecycle for one title id:
 *
 *   claim (singleflight) -> fetch upstream -> raw persistence -> enrich ->
 *   publish -> completion, with every failure parked behind the negative cache.
 *
 * It composes three outbound ports — `source`, `store`, `publisher` — so the
 * pipeline is testable with in-memory fakes and the workerd/Neon adapters stay
 * out of the use case. Retry policy is owned HERE, in the negative-cache TTLs:
 * an empty upstream parks for a week (`emptySeconds`), a refusing upstream for
 * a day (`refusalSeconds`), any other failure for an hour (`failureSeconds`),
 * and the claim re-acquires once the TTL elapses. What kind of failure a row
 * records is `./ingest-failure`'s taxonomy; which TTL a kind parks for, and the
 * row it parks as, is `./parked-failure`'s.
 *
 * Pipeline callers funnel through {@link ingest}: it acquires the claim and
 * runs the pipeline, or reports the persisted guard without touching upstream.
 *
 * Only the two writes that settle the claim are fenced on it: the completion
 * (`markDone`) and the failure (`markFailed`). When another invocation has
 * taken the claim over, the fenced write changes nothing and the run reports
 * `claim_lost`, because the work's outcome is the winner's to write; a lost
 * failure parks nothing and raises no alarm. The raw writes and the publish are
 * not fenced: whatever of them a losing run reached before its fenced write —
 * both raw rows, then a new published version of the work — stays written.
 *
 * The caller's `signal` (a cron pass's deadline) aborts the upstream requests
 * and nothing after them. An abort while the run still waits on them aborts
 * them, and the run rethrows the caller's reason with nothing written but its
 * claim. Once both have answered, an abort no longer stops the run: it goes on
 * and settles the claim as usual, except that an error it then throws is
 * rethrown rather than parked, and the rows written before it stay. A stopped
 * run parks nothing behind the negative cache — a stop is not the upstream
 * failing — and its claim lapses after RUNNING_TTL like any stopped holder's.
 *
 * The pipeline phases live as module-level functions over a bundled
 * {@link IngestRuntime}; the class keeps only the public lifecycle surface.
 * Writes go through the `store` port's builder plans over this request's Prisma
 * runtime, consistent with the ingest layer owning all mutations.
 */
import type { CatalogPrisma } from "../db/prisma";
import { enrichWork, type EnrichResult } from "../enrich/enrich";
import { upstreamUnavailable } from "../lib/errors";
import {
  classifyIngestFailure, IngestErrorCode, operatorRecord, type IngestFailure,
} from "./ingest-failure";
import { JobStore, type ClaimWrite, type FailureOptions, type IngestGuard, type JobClaim } from "./jobs";
import { parkedFailure, type IngestTtl } from "./parked-failure";
import { consoleRefusalAlarm, type RefusalAlarm } from "./refusal-alarm";
import { saveRawAnitabi as writeRawAnitabi, saveRawBangumi as writeRawBangumi, type RawPayload } from "./raw-store";
import {
  fetchAnitabiPoints,
  fetchBangumiSubject,
  type AnitabiPoint,
  type BangumiSubject,
  type FetchLike,
  type UpstreamName,
  UpstreamFetchError,
} from "./sources";

/**
 * Negative-cache TTLs: retry ordinary failures hourly, recheck empties weekly.
 * A refusal is not a failure that clears with time, so its TTL is a recheck
 * cadence rather than a backoff: one request per refused work per day, so
 * restored access is picked up within a day without being asked for hourly.
 * An egress refusal is OURS, not the upstream's: the ceiling clears within
 * the hour, so it parks for an hour — never for the upstream's 24h (#1792).
 */
export const DEFAULT_INGEST_TTL = {
  failureSeconds: 60 * 60,
  refusalSeconds: 24 * 60 * 60,
  emptySeconds: 7 * 24 * 60 * 60,
  egressSeconds: 60 * 60,
} as const;

/** Knobs for {@link IngestBangumi.ingest} (defaulted for prod; tests inject `fetchImpl`). */
export interface IngestBangumiOptions {
  fetchImpl?: FetchLike;
  /** The caller's cancellation: it aborts the upstream requests in flight; the module header says what a run it stops has written. */
  signal?: AbortSignal;
}

/** Persisted singleflight + negative-cache marker for a bangumi id. */
export type { IngestGuard } from "./jobs";

/** The claim outcome: this caller's claim when it won the singleflight, else the guard. */
export type IngestClaim = JobClaim | Exclude<IngestGuard, "ready">;

/**
 * Discriminated union: the outcome of one {@link IngestBangumi.ingest} call.
 * `claim_lost` is a run whose claim another invocation took over before it
 * finished: its fenced completion or failure write changed nothing, and the
 * work's outcome is the winner's (the module header says what it did write).
 */
export type IngestResult =
  | { status: "ingested"; version: number; pointCount: number }
  | { status: "in_progress" }
  | { status: "empty"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "claim_lost" };

/** Upstream source port: fetch the Bangumi subject + Anitabi points, under the run's fetch and signal. */
export interface IngestSource {
  fetchBangumi(bangumiId: string, call: IngestBangumiOptions): Promise<BangumiSubject>;
  fetchPoints(bangumiId: string, call: IngestBangumiOptions): Promise<AnitabiPoint[]>;
}

/** The narrow ingest-lifecycle surface read paths call (no pipeline internals). */
export interface IngestLifecycle {
  guard(bangumiId: string): Promise<IngestGuard>;
  ensurePending(bangumiId: string): Promise<void>;
  claim(bangumiId: string): Promise<IngestClaim>;
  runClaimed(claim: JobClaim, opts?: IngestBangumiOptions): Promise<IngestResult>;
}

/** Persistence store port: raw-zone writes + the ingest_jobs state machine. */
export interface IngestStore {
  acquire(bangumiId: string): Promise<JobClaim | null>;
  guard(bangumiId: string): Promise<IngestGuard>;
  ensurePending(bangumiId: string): Promise<void>;
  markDone(claim: JobClaim): Promise<ClaimWrite>;
  markFailed(claim: JobClaim, opts: FailureOptions): Promise<ClaimWrite>;
  /** Whether a refusal from `upstream` is already parked behind a live negative cache. */
  hasLiveRefusal(upstream: UpstreamName): Promise<boolean>;
  saveRawBangumi(bangumiId: string, payload: RawPayload): Promise<void>;
  saveRawAnitabi(bangumiId: string, payload: RawPayload): Promise<void>;
}

/** Publisher port: enrich the raw zone and atomically publish a new version. */
export interface IngestPublisher {
  publish(bangumiId: string): Promise<EnrichResult>;
}

/** The ports + TTL an ingest phase needs, bundled so module helpers stay small. */
interface IngestRuntime {
  source: IngestSource;
  store: IngestStore;
  publisher: IngestPublisher;
  ttl: IngestTtl;
  alarm: RefusalAlarm;
}

/** The complete Bangumi ingest lifecycle, composed over three ports. */
export class IngestBangumi {
  private readonly runtime: IngestRuntime;
  constructor(
    source: IngestSource,
    store: IngestStore,
    publisher: IngestPublisher,
    ttl: IngestTtl = DEFAULT_INGEST_TTL,
    alarm: RefusalAlarm = consoleRefusalAlarm(),
  ) {
    this.runtime = { source, store, publisher, ttl, alarm };
  }

  /** Read the persisted marker without claiming ready work. */
  guard(bangumiId: string): Promise<IngestGuard> {
    return this.runtime.store.guard(bangumiId);
  }

  ensurePending(bangumiId: string): Promise<void> {
    return this.runtime.store.ensurePending(bangumiId);
  }

  /** Ingest a work end-to-end behind one singleflight gate; losers return the persisted outcome. */
  async ingest(bangumiId: string, opts: IngestBangumiOptions = {}): Promise<IngestResult> {
    const claim = await this.claim(bangumiId);
    if (typeof claim !== "string") return this.runClaimed(claim, opts);
    if (claim === "empty") return { status: "empty", reason: "no points" };
    return { status: "in_progress" };
  }

  /** Atomically reserve the claim; a loser reads the persisted marker. */
  async claim(bangumiId: string): Promise<IngestClaim> {
    const claim = await this.runtime.store.acquire(bangumiId);
    if (claim !== null) return claim;
    const guard = await this.runtime.store.guard(bangumiId);
    return guard === "ready" ? "in_progress" : guard;
  }

  /** Run the full pipeline for a claim this caller already holds. */
  runClaimed(claim: JobClaim, opts: IngestBangumiOptions = {}): Promise<IngestResult> {
    return runSafely(this.runtime, claim, opts);
  }

}

/** Negative-cache every failure and preserve typed upstream transport errors; a caller's stop is rethrown unrecorded. */
async function runSafely(runtime: IngestRuntime, claim: JobClaim, call: IngestBangumiOptions): Promise<IngestResult> {
  try {
    return await runPipeline(runtime, claim, call);
  } catch (err) {
    if (call.signal?.aborted === true) throw err;
    return handleError(runtime, claim, err);
  }
}

/** Park the classified failure; rethrow upstream failures as defined 502s, unless the claim was lost. */
async function handleError(runtime: IngestRuntime, claim: JobClaim, err: unknown): Promise<IngestResult> {
  const result = await fail(runtime, claim, classifyIngestFailure(err));
  // An egress refusal is deliberately NOT rethrown as UPSTREAM_UNAVAILABLE: the
  // upstream never answered, our ceiling clears within the hour, and the
  // parked row's `egress_refused` code is the signal a human reads (#1792).
  if (err instanceof UpstreamFetchError && result.status !== "claim_lost") throw upstreamUnavailable(err.upstream, err);
  return result;
}

/** Fetch -> raw -> enrich -> publish -> completion for the held claim. */
async function runPipeline(runtime: IngestRuntime, claim: JobClaim, call: IngestBangumiOptions): Promise<IngestResult> {
  const { subject, points } = await fetchUpstream(runtime.source, claim.workId, call);
  if (points.length === 0) return fail(runtime, claim, { code: IngestErrorCode.NotFound, cause: "no points", upstream: null });
  await runtime.store.saveRawBangumi(claim.workId, subject);
  await runtime.store.saveRawAnitabi(claim.workId, points);
  const enriched = await runtime.publisher.publish(claim.workId);
  if (await runtime.store.markDone(claim) === "claim_lost") return claimLost(claim);
  return { status: "ingested", version: enriched.version, pointCount: enriched.pointCount };
}

/**
 * The run's outcome is not this caller's to record: another invocation took the
 * claim over, and the fenced write changed nothing. Logged so the overlap is
 * visible; the caller counts the work as held elsewhere, never as done.
 */
function claimLost(claim: JobClaim): IngestResult {
  console.warn(`[ingest] claim lost for work ${claim.workId}: another invocation took the job over, so this run's outcome was not recorded`);
  return { status: "claim_lost" };
}

/** Fetch both upstream sources in parallel. */
async function fetchUpstream(
  source: IngestSource,
  bangumiId: string,
  call: IngestBangumiOptions,
): Promise<{ subject: BangumiSubject; points: AnitabiPoint[] }> {
  const [subject, points] = await Promise.all([
    source.fetchBangumi(bangumiId, call),
    source.fetchPoints(bangumiId, call),
  ]);
  return { subject, points };
}

/** Negative-cache the failure (clears the 'running' row), alarm a new refusal, report it. */
async function fail(runtime: IngestRuntime, claim: JobClaim, failure: IngestFailure): Promise<IngestResult> {
  const alarmDue = await refusalAlarmDue(runtime.store, failure);
  if (await runtime.store.markFailed(claim, parkedFailure(runtime.ttl, failure)) === "claim_lost") return claimLost(claim);
  if (alarmDue && failure.upstream !== null) {
    runtime.alarm.upstreamRefused({ upstream: failure.upstream, workId: claim.workId, detail: operatorRecord(failure) });
  }
  const status = failure.code === IngestErrorCode.NotFound ? "empty" : "failed";
  return { status, reason: failure.cause };
}

/** A refusal alarms only when its source has no live refusal on record yet. */
async function refusalAlarmDue(store: IngestStore, failure: IngestFailure): Promise<boolean> {
  if (failure.code !== IngestErrorCode.UpstreamRefused || failure.upstream === null) return false;
  return !(await store.hasLiveRefusal(failure.upstream));
}

/** The production `IngestBangumi` over this request's Prisma seam (#1792: egress required for anitabi). */
export function catalogIngestBangumi(
  query: CatalogPrisma,
  egressSigningKey?: string,
  alarm: RefusalAlarm = consoleRefusalAlarm(),
): IngestBangumi {
  const jobs = new JobStore(query);
  return new IngestBangumi(
    {
      fetchBangumi: (bangumiId, call) => fetchBangumiSubject(bangumiId, call),
      fetchPoints: (bangumiId, call) => fetchAnitabiPoints(bangumiId, { ...call, egressSigningKey }),
    },
    {
      acquire: (bangumiId) => jobs.acquire(bangumiId),
      guard: (bangumiId) => jobs.guard(bangumiId),
      ensurePending: (bangumiId) => jobs.ensurePending(bangumiId),
      markDone: (claim) => jobs.markDone(claim),
      markFailed: (claim, opts) => jobs.markFailed(claim, opts),
      hasLiveRefusal: (upstream) => jobs.hasLiveRefusal(upstream),
      saveRawBangumi: (bangumiId, payload) => writeRawBangumi(query, bangumiId, payload),
      saveRawAnitabi: (bangumiId, payload) => writeRawAnitabi(query, bangumiId, payload),
    },
    { publish: (bangumiId) => enrichWork(query, bangumiId) },
    DEFAULT_INGEST_TTL,
    alarm,
  );
}
