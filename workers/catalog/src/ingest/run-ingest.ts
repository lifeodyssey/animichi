/**
 * Per-work ingest for the daily run (#1006 AC1/AC4/AC6 production adapter).
 *
 * ingestRunWork runs the fetch -> raw -> history -> provenance -> enrich ->
 * publish pipeline for one work within a run, consuming the run's budget and
 * reporting a source-aware outcome. A failed work never reaches publish, so its
 * published pointer is not advanced. Provenance and raw-history capture happen
 * across this request's Prisma runtime so the run is diagnosable after the fact.
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
  egressSigningKey?: string,
): Promise<RunWorkOutcome> {
  if (!canSpendWork(budget)) return { outcome: "exhausted" };
  spendWork(budget, 2, 0);
  const fetched = await fetchSources(bangumiId, egressSigningKey);
  if (!fetched.ok) {
    return { outcome: "fetchFailed", source: fetched.source, attempted: fetched.attempted, reason: fetched.reason };
  }
  if (fetched.points.length === 0) return { outcome: "empty", source: "anitabi", reason: "no points" };
  await writeRaw(query, runId, bangumiId, fetched);
  await captureAll(query, runId, bangumiId, fetched);
  return publish(query, bangumiId);
}

/** Fetch both sources; a failure names the source that threw. */
async function fetchSources(bangumiId: string, egressSigningKey?: string): Promise<FetchResult> {
  const subject = await fetchBangumiSubject(bangumiId).then(
    (value) => ({ ok: true as const, subject: value }),
    (reason: unknown) => failedResult("bangumi", reason, ["bangumi"]),
  );
  if (!subject.ok) return subject;
  const points = await fetchAnitabiPoints(bangumiId, { egressSigningKey }).then(
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

/** Capture work + per-point provenance for the run. */
async function captureAll(
  query: CatalogPrisma,
  runId: string,
  bangumiId: string,
  fetched: OkFetch,
): Promise<void> {
  const map = pointFieldMap();
  await captureProvenance(query, workProvenance(bangumiId));
  for (const point of fetched.points) {
    const pointId = pointIdOf(point);
    if (pointId) await captureProvenance(query, pointProvenance(bangumiId, pointId, map));
  }
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
    const result = await enrichWork(query, bangumiId);
    return { outcome: "ingested", version: result.version };
  } catch (err) {
    return { outcome: "pipelineFailed", stage: "enrich", reason: message(err) };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
