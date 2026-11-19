// TODO(refactor-skeleton): vertical slice — structure design catalog #837/#838
/**
 * Fast Anitabi L1 preview mapping shared by title and work-id read paths. The
 * request's signal travels in the `SourceConfig`, so a caller's cancel aborts
 * the preview's upstream calls and surfaces as itself, never as an outage.
 */

import { upstreamUnavailable } from "../lib/errors";
import { optional } from "../lib/optional";
import { withUpstreamUnavailable } from "../lib/upstream";
import {
  fetchAnitabiLite,
  fetchBangumiSearch,
  UpstreamNotFoundError,
  type AnitabiLite,
  type AnitabiPoint,
  type SourceConfig,
} from "../ingest/sources";
import type { Point } from "../types";

/** A resolved title plus its fast `/lite` point preview. */
export interface MissPreview {
  bangumiId: string;
  points: Point[];
}

/** Resolve a title and return a non-empty preview, preserving search miss behavior. */
export async function previewForQuery(query: string, cfg: SourceConfig): Promise<MissPreview | null> {
  const bangumiId = await bangumiIdResolve(query, cfg);
  if (!bangumiId) return null;
  const preview = await previewForWork(bangumiId, cfg);
  return preview.points.length > 0 ? preview : null;
}

/** Fetch a preview for an already-resolved bangumi id, including an empty preview. */
export async function previewForWork(bangumiId: string, cfg: SourceConfig): Promise<MissPreview> {
  const lite = await fetchLitePreview(bangumiId, cfg);
  return { bangumiId, points: lite.points.map((point) => litePoint(point, bangumiId)) };
}

/** Resolve a title via Bangumi; upstream failures become typed retryable errors. */
async function bangumiIdResolve(query: string, cfg: SourceConfig): Promise<string | null> {
  return withUpstreamUnavailable("bangumi", () => fetchBangumiSearch(query, cfg), cfg.signal);
}

/** Treat Anitabi 404 as a real empty preview and other failures as outages; a caller's cancel stays its own. */
async function fetchLitePreview(bangumiId: string, cfg: SourceConfig): Promise<AnitabiLite> {
  try {
    return await fetchAnitabiLite(bangumiId, cfg);
  } catch (error) {
    if (error instanceof UpstreamNotFoundError) return { points: [], total: 0 };
    cfg.signal?.throwIfAborted();
    throw upstreamUnavailable("anitabi", error);
  }
}

/** Map one official Anitabi `/lite` point to the public point contract. */
function litePoint(point: AnitabiPoint, bangumiId: string): Point {
  const [latitude, longitude] = liteGeo(point.geo);
  return {
    ...liteBase(point, bangumiId, latitude, longitude),
    ...optional({
      episode: liteInt(point.ep), time_seconds: liteInt(point.s),
      origin: liteText(point.origin), origin_url: liteText(point.originURL ?? point.origin_url),
    }),
  };
}

function liteBase(point: AnitabiPoint, bangumiId: string, latitude: number, longitude: number): Point {
  return {
    id: liteString(point.id),
    name: liteString(point.name),
    bangumi_id: bangumiId,
    screenshot_url: liteImage(point.image),
    latitude,
    longitude,
  };
}

function liteGeo(raw: unknown): [number, number] {
  if (!Array.isArray(raw) || raw.length < 2) return [0, 0];
  return [Number(raw[0]) || 0, Number(raw[1]) || 0];
}

function liteImage(raw: unknown): string {
  const url = liteString(raw);
  return url.startsWith("/") ? `https://image.anitabi.cn${url}` : url;
}

function liteString(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function liteText(raw: unknown): string | null {
  const text = liteString(raw);
  return text === "" ? null : text;
}

function liteInt(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : null;
}
