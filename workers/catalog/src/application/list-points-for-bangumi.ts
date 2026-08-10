/**
 * `pointsByBangumi` application use case: the published points for a Bangumi,
 * in scene order, through ONE Neon read port.
 *
 * Orchestration only — the single SELECT (whose `ORDER BY` defines "scene
 * order") and the raw-row mapping live in the outbound adapter
 * `adapters/outbound/bangumi-points.ts`; this file assembles the contract
 * `SearchResult` from validated rows and never touches I/O.
 *
 * Ordering contract (the "requested ordering"): a Bangumi's points come back in
 * scene order — episode ASC, then time_seconds ASC, then id ASC. An unknown or
 * empty Bangumi yields `{ rows: [] }` with `synced_at` falling back to now.
 */

import { optional } from "../lib/optional";
import type { Point } from "../types";

/** A published point row, as read and validated by the outbound adapter. */
export interface PublishedPointRow {
  id: string;
  name: string;
  name_cn: string | null;
  bangumi_id: string | null;
  episode: number | null;
  time_seconds: number | null;
  image: string | null;
  latitude: number;
  longitude: number;
  title: string | null;
  title_cn: string | null;
  cover_url: string | null;
  city?: string | null;
  // workerd's raw pg returns timestamptz as a string (Node parses it to Date) — accept both.
  synced_at: Date | string | null;
}

/** The ONE outbound read the use case depends on. */
export interface PointsByBangumiPort {
  pointsForBangumi(bangumiId: string): Promise<PublishedPointRow[]>;
}

/** Response mirrors the contract `SearchResult` (`rows` in scene order). */
export interface PointsByBangumiResult {
  rows: Point[];
  synced_at: string;
  partial?: boolean;
}

/** The published points for a bangumi id, in scene order. */
export async function pointsByBangumi(
  port: PointsByBangumiPort,
  bangumiId: string,
): Promise<PointsByBangumiResult> {
  const rows = await port.pointsForBangumi(bangumiId);
  return { rows: rows.map(toPoint), synced_at: syncedAt(rows) };
}

/** Map a validated DB row to the contract `Point` shape. */
function toPoint(r: PublishedPointRow): Point {
  return {
    ...identity(r),
    ...geo(r),
    ...meta(r),
  };
}

/** Required identity fields (id / name / bangumi_id / screenshot_url). */
function identity(r: PublishedPointRow): Pick<Point, "id" | "name" | "bangumi_id" | "screenshot_url"> {
  return { id: r.id, name: r.name, bangumi_id: r.bangumi_id ?? "", screenshot_url: r.image ?? "" };
}

/** Required geo fields. */
function geo(r: PublishedPointRow): Pick<Point, "latitude" | "longitude"> {
  return { latitude: r.latitude, longitude: r.longitude };
}

/** Optional metadata fields, omitted when null. */
function meta(r: PublishedPointRow): Partial<Point> {
  return optional({
    name_cn: r.name_cn, episode: r.episode, time_seconds: r.time_seconds,
    title: r.title, title_cn: r.title_cn, cover_url: r.cover_url, city: r.city,
  });
}

/** `synced_at` from the work's `bangumi.updated_at`, else now. Accepts a Date or
 * a raw timestamptz string (workerd's pg driver does not parse it to a Date). */
function syncedAt(rows: PublishedPointRow[]): string {
  const stamp = rows[0]?.synced_at;
  return stamp ? new Date(stamp).toISOString() : new Date().toISOString();
}
