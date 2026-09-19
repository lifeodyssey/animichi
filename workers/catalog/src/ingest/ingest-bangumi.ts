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
 * records is `./ingest-failure`'s taxonomy.
 *
 * Pipeline callers funnel through {@link ingest}: it acquires the claim and
 * runs the pipeline, or reports the persisted guard without touching upstream.
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
  classifyIngestFailure, failedStage, IngestErrorCode, operatorRecord, type IngestFailure,
} from "./ingest-failure";
import { JobStore, type FailureOptions, type IngestGuard } from "./jobs";
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
}

/** Persisted singleflight + negative-cache marker for a bangumi id. */
export type { IngestGuard } from "./jobs";

/** The claim outcome: acquired for the singleflight winner, else the guard. */
export type IngestClaim = "acquired" | Exclude<IngestGuard, "ready">;

/** Discriminated union: the outcome of one {@link IngestBangumi.ingest} call. */
export type IngestResult =
  | { status: "ingested"; version: number; pointCount: number }
  | { status: "in_progress" }
  | { status: "empty"; reason: string }
  | { status: "failed"; reason: string };

/** Upstream source port: fetch the Bangumi subject + Anitabi points. */
export interface IngestSource {
  fetchBangumi(bangumiId: string, fetchImpl?: FetchLike): Promise<BangumiSubject>;
  fetchPoints(bangumiId: string, fetchImpl?: FetchLike): Promise<AnitabiPoint[]>;
}

/** The narrow ingest-lifecycle surface read paths call (no pipeline internals). */
export interface IngestLifecycle {
  guard(bangumiId: string): Promise<IngestGuard>;
  ensurePending(bangumiId: string): Promise<void>;
  claim(bangumiId: string): Promise<IngestClaim>;
  markDone(bangumiId: string): Promise<void>;
  runClaimed(bangumiId: string, opts?: IngestBangumiOptions): Promise<IngestResult>;
}

/** Persistence store port: raw-zone writes + the ingest_jobs state machine. */
export interface IngestStore {
  acquire(bangumiId: string): Promise<boolean>;
  guard(bangumiId: string): Promise<IngestGuard>;
  ensurePending(bangumiId: string): Promise<void>;
  markDone(bangumiId: string): Promise<void>;
  markFailed(bangumiId: string, opts: FailureOptions): Promise<void>;
  /** Whether a refusal from `upstream` is already parked behind a live negative cache. */
  hasLiveRefusal(upstream: UpstreamName): Promise<boolean>;
  saveRawBangumi(bangumiId: string, payload: RawPayload): Promise<void>;
  saveRawAnitabi(bangumiId: string, payload: RawPayload): Promise<void>;
}

/** Publisher port: enrich the raw zone and atomically publish a new version. */
export interface IngestPublisher {
  publish(bangumiId: string): Promise<EnrichResult>;
}

/** Negative-cache TTL policy for {@link IngestBangumi}. */
export interface IngestTtl {
  failureSeconds: number;
  refusalSeconds: number;
  emptySeconds: number;
  egressSeconds: number;
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

  markDone(bangumiId: string): Promise<void> {
    return this.runtime.store.markDone(bangumiId);
  }

  /** Ingest a work end-to-end behind one singleflight gate; losers return the persisted outcome. */
  async ingest(bangumiId: string, opts: IngestBangumiOptions = {}): Promise<IngestResult> {
    const claim = await this.claim(bangumiId);
    if (claim === "acquired") return this.runClaimed(bangumiId, opts);
    if (claim === "empty") return { status: "empty", reason: "no points" };
    return { status: "in_progress" };
  }

  /** Atomically reserve the claim; a loser reads the persisted marker. */
  async claim(bangumiId: string): Promise<IngestClaim> {
    if (await this.runtime.store.acquire(bangumiId)) return "acquired";
    const guard = await this.runtime.store.guard(bangumiId);
    return guard === "ready" ? "in_progress" : guard;
  }

  /** Run the full pipeline for a claim this caller already holds. */
  runClaimed(bangumiId: string, opts: IngestBangumiOptions = {}): Promise<IngestResult> {
    return runSafely(this.runtime, bangumiId, opts.fetchImpl);
  }

}

/** Negative-cache every failure, then preserve typed upstream transport errors. */
async function runSafely(runtime: IngestRuntime, bangumiId: string, fetchImpl?: FetchLike): Promise<IngestResult> {
  try {
    return await runPipeline(runtime, bangumiId, fetchImpl);
  } catch (err) {
    return handleError(runtime, bangumiId, err);
  }
}

/** Park the classified failure; rethrow upstream failures as defined 502s. */
async function handleError(runtime: IngestRuntime, bangumiId: string, err: unknown): Promise<IngestResult> {
  const result = await fail(runtime, bangumiId, classifyIngestFailure(err));
  // An egress refusal is deliberately NOT rethrown as UPSTREAM_UNAVAILABLE: the
  // upstream never answered, our ceiling clears within the hour, and the
  // parked row's `egress_refused` code is the signal a human reads (#1792).
  if (err instanceof UpstreamFetchError) throw upstreamUnavailable(err.upstream, err);
  return result;
}

/** Fetch -> raw -> enrich -> publish -> completion for the held claim. */
async function runPipeline(runtime: IngestRuntime, bangumiId: string, fetchImpl?: FetchLike): Promise<IngestResult> {
  const { subject, points } = await fetchUpstream(runtime.source, bangumiId, fetchImpl);
  if (points.length === 0) return fail(runtime, bangumiId, { code: IngestErrorCode.NotFound, cause: "no points", upstream: null });
  await runtime.store.saveRawBangumi(bangumiId, subject);
  await runtime.store.saveRawAnitabi(bangumiId, points);
  const enriched = await runtime.publisher.publish(bangumiId);
  await runtime.store.markDone(bangumiId);
  return { status: "ingested", version: enriched.version, pointCount: enriched.pointCount };
}

/** Fetch both upstream sources in parallel. */
async function fetchUpstream(
  source: IngestSource,
  bangumiId: string,
  fetchImpl?: FetchLike,
): Promise<{ subject: BangumiSubject; points: AnitabiPoint[] }> {
  const [subject, points] = await Promise.all([
    source.fetchBangumi(bangumiId, fetchImpl),
    source.fetchPoints(bangumiId, fetchImpl),
  ]);
  return { subject, points };
}

/** Negative-cache the failure (clears the 'running' row), alarm a new refusal, report it. */
async function fail(runtime: IngestRuntime, bangumiId: string, failure: IngestFailure): Promise<IngestResult> {
  const alarmDue = await refusalAlarmDue(runtime.store, failure);
  await runtime.store.markFailed(bangumiId, parkedFailure(runtime.ttl, failure));
  if (alarmDue && failure.upstream !== null) {
    runtime.alarm.upstreamRefused({ upstream: failure.upstream, workId: bangumiId, detail: operatorRecord(failure) });
  }
  const status = failure.code === IngestErrorCode.NotFound ? "empty" : "failed";
  return { status, reason: failure.cause };
}

/** A refusal alarms only when its source has no live refusal on record yet. */
async function refusalAlarmDue(store: IngestStore, failure: IngestFailure): Promise<boolean> {
  if (failure.code !== IngestErrorCode.UpstreamRefused || failure.upstream === null) return false;
  return !(await store.hasLiveRefusal(failure.upstream));
}

function parkedFailure(ttl: IngestTtl, failure: IngestFailure): FailureOptions {
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

/** The production `IngestBangumi` over this request's Prisma seam (#1792: egress required for anitabi). */
export function catalogIngestBangumi(
  query: CatalogPrisma,
  egressSigningKey?: string,
  alarm: RefusalAlarm = consoleRefusalAlarm(),
): IngestBangumi {
  const jobs = new JobStore(query);
  return new IngestBangumi(
    {
      fetchBangumi: (bangumiId, fetchImpl) => fetchBangumiSubject(bangumiId, { fetchImpl }),
      fetchPoints: (bangumiId, fetchImpl) => fetchAnitabiPoints(bangumiId, { fetchImpl, egressSigningKey }),
    },
    {
      acquire: (bangumiId) => jobs.acquire(bangumiId),
      guard: (bangumiId) => jobs.guard(bangumiId),
      ensurePending: (bangumiId) => jobs.ensurePending(bangumiId),
      markDone: (bangumiId) => jobs.markDone(bangumiId),
      markFailed: (bangumiId, opts) => jobs.markFailed(bangumiId, opts),
      hasLiveRefusal: (upstream) => jobs.hasLiveRefusal(upstream),
      saveRawBangumi: (bangumiId, payload) => writeRawBangumi(query, bangumiId, payload),
      saveRawAnitabi: (bangumiId, payload) => writeRawAnitabi(query, bangumiId, payload),
    },
    { publish: (bangumiId) => enrichWork(query, bangumiId) },
    DEFAULT_INGEST_TTL,
    alarm,
  );
}
