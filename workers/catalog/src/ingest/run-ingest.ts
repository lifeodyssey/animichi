/**
 * Per-work ingest for the daily run (#1006 AC1/AC4/AC6 production adapter).
 *
 * ingestRunWork runs the fetch -> raw -> history -> provenance -> enrich ->
 * publish pipeline for one work within a run, consuming the run's budget and
 * reporting a source-aware outcome. A failed work never reaches publish, so the
 * run records no published marker for it. Provenance and raw-history capture happen
 * across this request's Prisma runtime so the run is diagnosable after the fact.
 *
 * The pass's deadline travels in `upstream.signal` and reaches both fetches.
 * Once it has passed the work reports `exhausted`, as for a spent budget: the
 * run stops there and records its attempt, and a fetch the deadline cut off is
 * never tallied as its source failing.
 */
import { canSpendWork, spendWork, type Budget } from "./budgets";
import type { RunSource, RunWorkOutcome } from "./daily-run";
import { appendRawHistory } from "./raw_history";
import { captureProvenance, pointFieldMap, type ProvenanceRecord } from "./provenance";
import type { CatalogPrisma } from "../db/prisma";
import { saveRawAnitabi, saveRawBangumi } from "./raw-store";
import { enrichWork } from "../enrich/enrich";
import {
  fetchAnitabiPoints,
  fetchBangumiSubject,
  type AnitabiPoint,
  type BangumiSubject,
  type UpstreamAccess,
} from "./sources";
import { ANITABI_ATTRIBUTION, ANITABI_LICENSE_URL } from "@animichi/contract/anitabi-display";

/** The upstream fetch-outcome for one work, or null when the subject fails. */
/** The fetch result: an ok payload pair, or the exact source that failed. */
type FetchResult =
  | { ok: true; subject: BangumiSubject; points: AnitabiPoint[] }
  | { ok: false; source: RunSource; attempted: readonly RunSource[]; reason: string };

/** The narrowed ok sub-variant used after the failure guard. */
type OkFetch = Extract<FetchResult, { ok: true }>;

/** Ingest a work within a run; consumes budget and returns a source outcome. */
export async function ingestRunWork(
  query: CatalogPrisma,
  bangumiId: string,
  runId: string,
  budget: Budget,
  upstream: UpstreamAccess = {},
): Promise<RunWorkOutcome> {
  if (passOver(upstream) || !canSpendWork(budget)) return { outcome: "exhausted" };
  spendWork(budget, 2);
  const fetched = await fetchSources(bangumiId, upstream);
  if (!fetched.ok) return fetchFailure(fetched, upstream);
  if (fetched.points.length === 0) return { outcome: "empty", source: "anitabi", reason: "no points" };
  await writeRaw(query, runId, bangumiId, fetched);
  await captureAll(query, bangumiId, fetched.points);
  return publish(query, bangumiId);
}

/** Whether the pass's deadline has passed: no work starts, and no cut-off fetch is tallied. */
function passOver(upstream: UpstreamAccess): boolean {
  return upstream.signal?.aborted === true;
}

/** A failed fetch is its source's failure, unless the pass's deadline cut it off. */
function fetchFailure(fetched: Extract<FetchResult, { ok: false }>, upstream: UpstreamAccess): RunWorkOutcome {
  if (passOver(upstream)) return { outcome: "exhausted" };
  return { outcome: "fetchFailed", source: fetched.source, attempted: fetched.attempted, reason: fetched.reason };
}

/** Fetch both sources; a failure names the source that threw. */
async function fetchSources(bangumiId: string, upstream: UpstreamAccess): Promise<FetchResult> {
  const subject = await fetchBangumiSubject(bangumiId, { signal: upstream.signal }).then(
    (value) => ({ ok: true as const, subject: value }),
    (reason: unknown) => failedResult("bangumi", reason, ["bangumi"]),
  );
  if (!subject.ok) return subject;
  const points = await fetchAnitabiPoints(bangumiId, upstream).then(
    (value) => ({ ok: true as const, points: value }),
    (reason: unknown) => failedResult("anitabi", reason, ["bangumi", "anitabi"]),
  );
  if (!points.ok) return points;
  return { ok: true, subject: subject.subject, points: points.points };
}

/** A fetch-failure result carrying the source + a stable reason string. */
function failedResult(
  source: RunSource,
  reason: unknown,
  attempted: readonly RunSource[],
): Extract<FetchResult, { ok: false }> {
  return { ok: false, source, attempted, reason: reason instanceof Error ? reason.message : String(reason) };
}

/** Persist the raw payloads and their history rows. */
async function writeRaw(
  query: CatalogPrisma,
  runId: string,
  bangumiId: string,
  fetched: OkFetch,
): Promise<void> {
  await saveRawBangumi(query, bangumiId, fetched.subject);
  await saveRawAnitabi(query, bangumiId, fetched.points);
  await appendRawHistory(query, { workId: bangumiId, source: "bangumi", payload: fetched.subject, runId });
  await appendRawHistory(query, { workId: bangumiId, source: "anitabi", payload: fetched.points, runId });
}

/** Capture the work's provenance and each point's in one write: its round trips do not grow with the points. */
async function captureAll(query: CatalogPrisma, bangumiId: string, points: readonly AnitabiPoint[]): Promise<void> {
  await captureProvenance(query, [workProvenance(bangumiId), ...pointProvenances(bangumiId, points)]);
}

/** A point-scope row for each point with a usable upstream id; a malformed point is skipped. */
function pointProvenances(bangumiId: string, points: readonly AnitabiPoint[]): ProvenanceRecord[] {
  const map = pointFieldMap();
  return points.flatMap((point) => pointRow(bangumiId, pointIdOf(point), map));
}

/** The point's row, or none when it has no usable id. */
function pointRow(bangumiId: string, pointId: string | null, map: Record<string, string>): ProvenanceRecord[] {
  return pointId ? [pointProvenance(bangumiId, pointId, map)] : [];
}

/** The work-scope provenance row from the Bangumi subject. */
function workProvenance(bangumiId: string): ProvenanceRecord {
  return {
    scope: "work",
    entityId: bangumiId,
    workId: bangumiId,
    source: "bangumi",
    upstreamId: bangumiId,
    attribution: null,
    license: null,
    fieldMap: { title: "bangumi", title_cn: "bangumi", cover_url: "bangumi", summary: "bangumi", rating: "bangumi" },
  };
}

/** The point-scope provenance row from the Anitabi point. */
function pointProvenance(bangumiId: string, entityId: string, map: Record<string, string>): ProvenanceRecord {
  return {
    scope: "point",
    entityId,
    workId: bangumiId,
    source: "anitabi",
    upstreamId: entityId,
    attribution: ANITABI_ATTRIBUTION,
    license: ANITABI_LICENSE_URL,
    fieldMap: map,
  };
}

/** A point's upstream id, or null when malformed. */
function pointIdOf(point: AnitabiPoint): string | null {
  const id = point.id;
  return typeof id === "string" ? id : typeof id === "number" ? String(id) : null;
}

/** Enrich + publish the work; a failure becomes a pipeline failure. */
async function publish(query: CatalogPrisma, bangumiId: string): Promise<RunWorkOutcome> {
  try {
    await enrichWork(query, bangumiId);
    return { outcome: "ingested" };
  } catch (err) {
    return { outcome: "pipelineFailed", stage: "enrich", reason: message(err) };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
