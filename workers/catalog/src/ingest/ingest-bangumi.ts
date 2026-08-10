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
 * an empty upstream parks for a week (`emptySeconds`), any other failure for an
 * hour (`failureSeconds`), and the claim re-acquires once the TTL elapses.
 *
 * Callers (search, points-by-bangumi-id, the scheduled crons, the internal
 * entrypoint) all funnel through {@link ingest}: it acquires the claim and
 * runs the pipeline, or reports the persisted guard without touching upstream.
 *
 * Writes go through the `store` port's raw `sql` execute (the Drizzle read
 * schema is query-only), consistent with the ingest layer owning all mutations.
 */
import type { CatalogDb } from "../db/client";
import { enrichWork, type EnrichResult } from "../enrich/enrich";
import { upstreamUnavailable } from "../lib/errors";
import { JobStore, type FailureOptions, type IngestGuard } from "./jobs";
import { saveRawAnitabi as writeRawAnitabi, saveRawBangumi as writeRawBangumi, type RawPayload } from "./raw-store";
import {
  fetchAnitabiPoints,
  fetchBangumiSubject,
  type AnitabiPoint,
  type BangumiSubject,
  type FetchLike,
  UpstreamFetchError,
  UpstreamNotFoundError,
} from "./sources";

/** Error codes parked behind the negative cache (no bare strings). */
export const IngestErrorCode = {
  NotFound: "not_found",
  IngestError: "ingest_error",
} as const;

/** Negative-cache TTLs: retry ordinary failures hourly, recheck empties weekly. */
export const DEFAULT_INGEST_TTL = {
  failureSeconds: 60 * 60,
  emptySeconds: 7 * 24 * 60 * 60,
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
  claim(bangumiId: string): Promise<IngestClaim>;
  markDone(bangumiId: string): Promise<void>;
  runClaimed(bangumiId: string, opts?: IngestBangumiOptions): Promise<IngestResult>;
}

/** Persistence store port: raw-zone writes + the ingest_jobs state machine. */
export interface IngestStore {
  acquire(bangumiId: string): Promise<boolean>;
  guard(bangumiId: string): Promise<IngestGuard>;
  markDone(bangumiId: string): Promise<void>;
  markFailed(bangumiId: string, opts: FailureOptions): Promise<void>;
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
  emptySeconds: number;
}

/** The complete Bangumi ingest lifecycle, composed over three ports. */
export class IngestBangumi {
  constructor(
    private readonly source: IngestSource,
    private readonly store: IngestStore,
    private readonly publisher: IngestPublisher,
    private readonly ttl: IngestTtl = DEFAULT_INGEST_TTL,
  ) {}

  /** Read the persisted marker without claiming ready work. */
  guard(bangumiId: string): Promise<IngestGuard> {
    return this.store.guard(bangumiId);
  }

  /** Close a held claim — used by callers that finish without ingesting. */
  markDone(bangumiId: string): Promise<void> {
    return this.store.markDone(bangumiId);
  }

  /**
   * Ingest a work end-to-end behind one singleflight gate. The claim winner
   * runs the full pipeline; a loser (an in-flight peer, or a live negative
   * cache) returns the persisted outcome and does no work. Upstream transport
   * failures escape as typed retryable oRPC errors.
   */
  async ingest(bangumiId: string, opts: IngestBangumiOptions = {}): Promise<IngestResult> {
    const claim = await this.claim(bangumiId);
    if (claim === "acquired") return this.runClaimed(bangumiId, opts);
    if (claim === "empty") return { status: "empty", reason: "no points" };
    return { status: "in_progress" };
  }

  /** Atomically reserve the claim; a loser reads the persisted marker. */
  async claim(bangumiId: string): Promise<IngestClaim> {
    if (await this.store.acquire(bangumiId)) return "acquired";
    const guard = await this.store.guard(bangumiId);
    return guard === "ready" ? "in_progress" : guard;
  }

  /** Run the full pipeline for a claim this caller already holds. */
  runClaimed(bangumiId: string, opts: IngestBangumiOptions = {}): Promise<IngestResult> {
    return this.runSafely(bangumiId, opts.fetchImpl);
  }

  /** Negative-cache every failure, then preserve typed upstream transport errors. */
  private async runSafely(bangumiId: string, fetchImpl?: FetchLike): Promise<IngestResult> {
    try {
      return await this.runPipeline(bangumiId, fetchImpl);
    } catch (err) {
      return this.handleError(bangumiId, err);
    }
  }

  private async handleError(bangumiId: string, err: unknown): Promise<IngestResult> {
    if (err instanceof UpstreamNotFoundError) {
      return this.fail(bangumiId, IngestErrorCode.NotFound, String(err));
    }
    const result = await this.fail(bangumiId, IngestErrorCode.IngestError, String(err));
    if (err instanceof UpstreamFetchError) throw upstreamUnavailable(err.upstream, err);
    return result;
  }

  /** Fetch -> raw -> enrich -> publish -> completion for the held claim. */
  private async runPipeline(bangumiId: string, fetchImpl?: FetchLike): Promise<IngestResult> {
    const { subject, points } = await this.fetchUpstream(bangumiId, fetchImpl);
    if (points.length === 0) return this.fail(bangumiId, IngestErrorCode.NotFound, "no points");
    await this.store.saveRawBangumi(bangumiId, subject);
    await this.store.saveRawAnitabi(bangumiId, points);
    const enriched = await this.publisher.publish(bangumiId);
    await this.store.markDone(bangumiId);
    return { status: "ingested", version: enriched.version, pointCount: enriched.pointCount };
  }

  private async fetchUpstream(
    bangumiId: string,
    fetchImpl?: FetchLike,
  ): Promise<{ subject: BangumiSubject; points: AnitabiPoint[] }> {
    const [subject, points] = await Promise.all([
      this.source.fetchBangumi(bangumiId, fetchImpl),
      this.source.fetchPoints(bangumiId, fetchImpl),
    ]);
    return { subject, points };
  }

  /** Negative-cache the failure (clears the 'running' row) and report it. */
  private async fail(
    bangumiId: string, errorCode: string, reason: string,
  ): Promise<IngestResult> {
    const ttlSeconds = errorCode === IngestErrorCode.NotFound
      ? this.ttl.emptySeconds
      : this.ttl.failureSeconds;
    await this.store.markFailed(bangumiId, { errorCode, ttlSeconds, error: reason });
    const status = errorCode === IngestErrorCode.NotFound ? "empty" : "failed";
    return { status, reason };
  }
}

/** The production `IngestBangumi` over a Drizzle `CatalogDb`. */
export function catalogIngestBangumi(db: CatalogDb): IngestBangumi {
  const jobs = new JobStore(db);
  return new IngestBangumi(
    {
      fetchBangumi: (bangumiId, fetchImpl) => fetchBangumiSubject(bangumiId, { fetchImpl }),
      fetchPoints: (bangumiId, fetchImpl) => fetchAnitabiPoints(bangumiId, { fetchImpl }),
    },
    {
      acquire: (bangumiId) => jobs.acquire(bangumiId),
      guard: (bangumiId) => jobs.guard(bangumiId),
      markDone: (bangumiId) => jobs.markDone(bangumiId),
      markFailed: (bangumiId, opts) => jobs.markFailed(bangumiId, opts),
      saveRawBangumi: (bangumiId, payload) => writeRawBangumi(db, bangumiId, payload),
      saveRawAnitabi: (bangumiId, payload) => writeRawAnitabi(db, bangumiId, payload),
    },
    { publish: (bangumiId) => enrichWork(db, bangumiId) },
  );
}
