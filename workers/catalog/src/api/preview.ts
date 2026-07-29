/** Fast Anitabi L1 preview mapping shared by title and work-id read paths. */

import { upstreamUnavailable } from "../lib/errors";
import { optional } from "../lib/optional";
import { withUpstreamUnavailable } from "../lib/upstream";
import {
  fetchAnitabiLite,
  fetchBangumiSearch,
  UpstreamNotFoundError,
  type AnitabiLite,
  type AnitabiPoint,
  type FetchLike,
} from "../ingest/sources";
import type { PilgrimagePoint } from "../types";

/** A resolved work plus its fast `/lite` point preview. */
export interface MissPreview {
  workId: string;
  points: PilgrimagePoint[];
}

/** Resolve a title and return a non-empty preview, preserving search miss behavior. */
export async function previewForQuery(
  query: string,
  fetchImpl?: FetchLike,
): Promise<MissPreview | null> {
  const workId = await resolveWorkId(query, fetchImpl);
  if (!workId) return null;
  const preview = await previewForWork(workId, fetchImpl);
  return preview.points.length > 0 ? preview : null;
}

/** Fetch a preview for an already-resolved work id, including an empty preview. */
export async function previewForWork(
  workId: string,
  fetchImpl?: FetchLike,
): Promise<MissPreview> {
  const lite = await fetchLitePreview(workId, fetchImpl);
  return { workId, points: lite.points.map((point) => litePoint(point, workId)) };
}

/** Resolve a title via Bangumi; upstream failures become typed retryable errors. */
async function resolveWorkId(query: string, fetchImpl?: FetchLike): Promise<string | null> {
  return withUpstreamUnavailable("bangumi", () => fetchBangumiSearch(query, { fetchImpl }));
}

/** Treat Anitabi 404 as a real empty preview and other failures as outages. */
async function fetchLitePreview(workId: string, fetchImpl?: FetchLike): Promise<AnitabiLite> {
  try {
    return await fetchAnitabiLite(workId, { fetchImpl });
  } catch (error) {
    if (error instanceof UpstreamNotFoundError) return { points: [], total: 0 };
    throw upstreamUnavailable("anitabi", error);
  }
}

/** Map one official Anitabi `/lite` point to the public point contract. */
function litePoint(point: AnitabiPoint, workId: string): PilgrimagePoint {
  const [latitude, longitude] = liteGeo(point.geo);
  return {
    id: liteString(point.id),
    name: liteString(point.name),
    bangumi_id: workId,
    screenshot_url: liteImage(point.image),
    latitude,
    longitude,
    ...optional({ episode: liteInt(point.ep), time_seconds: liteInt(point.s) }),
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

function liteInt(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : null;
}
