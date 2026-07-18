/**
 * Public `animeOverview` read handler — catalog's first anonymous surface.
 *
 * Shape source of truth: packages/contract/src/contract.ts ->
 *   animeOverview(bangumi_id) -> AnimeOverview
 * Derives three views over a work's published points, all from already-public
 * catalog data (no user or internal pipeline fields):
 *   - `circles`: bubble aggregation grouped by region (city), with centroid.
 *   - `scenes`: 名場面 ranking — co-located points (`clusterByLocation`, 50m)
 *     collapse into one scene ranked by shot count.
 *   - `sample_routes`: the top regions with their member point ids.
 *
 * Read-only: a single typed `db.execute(sql`...`)` following the geo-query.ts
 * pattern. Wire shapes come from `../types` (import type erases at compile time,
 * keeping the contract's zod runtime out of the Worker bundle).
 */

import { sql } from "drizzle-orm";
import { clusterByLocation, type LocationCluster } from "../lib/clustering";
import type { AnimeOverview, AnimeOverviewCircle, AnimeSampleRoute, AnimeScene } from "../types";

export type { AnimeOverview };

const SCENE_LIMIT = 20;
const SAMPLE_ROUTE_REGION_LIMIT = 3;
const SAMPLE_ROUTE_POINT_CAP = 12;
const CLUSTER_RADIUS_M = 50;

/** The one DB capability this handler needs: run a query, get back `{ rows }`. */
export interface OverviewDb {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
}

/** Raw column shape returned by the overview read query. */
interface OverviewRow {
  id: string;
  name: string;
  image: string | null;
  latitude: number;
  longitude: number;
  city: string | null;
}

/** Assemble the public overview for one work; empty-but-valid when it has none. */
export async function animeOverview(
  db: OverviewDb,
  input: { bangumi_id: string },
): Promise<AnimeOverview> {
  const rows = await fetchRows(db, input.bangumi_id);
  return {
    bangumi_id: input.bangumi_id,
    points_length: rows.length,
    circles: buildCircles(rows),
    scenes: buildScenes(rows),
    sample_routes: buildSampleRoutes(rows),
  };
}

/** SELECT the work's points, id-ordered for deterministic downstream ordering. */
async function fetchRows(db: OverviewDb, bangumiId: string): Promise<OverviewRow[]> {
  const result = await db.execute(overviewQuery(bangumiId));
  return result.rows as OverviewRow[];
}

function overviewQuery(bangumiId: string) {
  return sql`
    SELECT id, name, image, latitude, longitude, city
    FROM points
    WHERE bangumi_id = ${bangumiId}
    ORDER BY id ASC
  `;
}

/** Group rows by non-empty region (city), preserving id order within a region. */
function groupByRegion(rows: OverviewRow[]): Map<string, OverviewRow[]> {
  const groups = new Map<string, OverviewRow[]>();
  for (const r of rows) {
    if (!r.city) continue;
    const bucket = groups.get(r.city) ?? [];
    bucket.push(r);
    groups.set(r.city, bucket);
  }
  return groups;
}

/** Region bubbles sorted by spot count desc, then region name asc. */
function buildCircles(rows: OverviewRow[]): AnimeOverviewCircle[] {
  const circles = [...groupByRegion(rows)].map(([region, members]) => toCircle(region, members));
  return circles.sort((a, b) => b.count - a.count || a.region.localeCompare(b.region));
}

function toCircle(region: string, members: OverviewRow[]): AnimeOverviewCircle {
  return { region, count: members.length, ...centroid(members) };
}

function centroid(members: OverviewRow[]): { lat: number; lng: number } {
  const lat = members.reduce((acc, m) => acc + m.latitude, 0) / members.length;
  const lng = members.reduce((acc, m) => acc + m.longitude, 0) / members.length;
  return { lat, lng };
}

/** 名場面 ranking: co-located clusters ranked by shot count, capped. */
function buildScenes(rows: OverviewRow[]): AnimeScene[] {
  const scenes = clusterByLocation(rows, CLUSTER_RADIUS_M).map(toScene);
  scenes.sort((a, b) => b.shot_count - a.shot_count || a.id.localeCompare(b.id));
  return scenes.slice(0, SCENE_LIMIT);
}

function toScene(cluster: LocationCluster<OverviewRow>): AnimeScene {
  const rep = representative(cluster);
  const base = sceneBase(rep, cluster.photoCount);
  return rep.city ? { ...base, city: rep.city } : base;
}

function sceneBase(rep: OverviewRow, shotCount: number): AnimeScene {
  return {
    id: rep.id,
    name: rep.name,
    screenshot_url: rep.image ?? "",
    shot_count: shotCount,
    lat: rep.latitude,
    lng: rep.longitude,
  };
}

/** The cluster's representative row (its `clusterId` member, always present). */
function representative(cluster: LocationCluster<OverviewRow>): OverviewRow {
  const rep = cluster.points.find((p) => p.id === cluster.clusterId);
  if (!rep) throw new Error(`cluster ${cluster.clusterId} has no representative row`);
  return rep;
}

/** One sample route per top region, listing its member point ids (capped). */
function buildSampleRoutes(rows: OverviewRow[]): AnimeSampleRoute[] {
  const groups = groupByRegion(rows);
  return rankRegions(groups)
    .slice(0, SAMPLE_ROUTE_REGION_LIMIT)
    .map((region) => toSampleRoute(region, groups.get(region) ?? []));
}

function rankRegions(groups: Map<string, OverviewRow[]>): string[] {
  return [...groups.entries()]
    .sort(([ar, a], [br, b]) => b.length - a.length || ar.localeCompare(br))
    .map(([region]) => region);
}

function toSampleRoute(region: string, members: OverviewRow[]): AnimeSampleRoute {
  return { region, point_ids: members.slice(0, SAMPLE_ROUTE_POINT_CAP).map((m) => m.id) };
}
