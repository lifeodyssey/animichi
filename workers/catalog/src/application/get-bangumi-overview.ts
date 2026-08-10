/**
 * GetBangumiOverview — the overview projection use case (CATALOG-5 #946).
 *
 * Owns the three-read projection (circles / scenes / sample_itineraries)
 * over a work's published points, reading through a narrow reader port; the
 * SQL lives only in the outbound adapter (overview-points.ts).
 */

import { clusterByLocation, type LocationCluster } from "../domain/clustering/cluster";
import type { OverviewPointRow, OverviewPointsReader } from "../adapters/outbound/overview-points";
import type { AnimeOverview, AnimeOverviewCircle, AnimeSampleItinerary, AnimeScene } from "../types";

const SCENE_LIMIT = 20;
const SAMPLE_ITINERARY_REGION_LIMIT = 3;
const SAMPLE_ITINERARY_POINT_CAP = 12;
const CLUSTER_RADIUS_M = 50;

/** Thrown only when the requested anime itself is absent from the catalog. */
export class AnimeOverviewNotFoundError extends Error {
  constructor(public readonly bangumiId: string) {
    super(`catalog work not found for bangumi_id=${bangumiId}`);
    this.name = "AnimeOverviewNotFoundError";
  }
}

/** Assemble the public overview for one work; empty-but-valid when it has none. */
export async function getBangumiOverview(
  reader: OverviewPointsReader,
  input: { bangumi_id: string },
): Promise<AnimeOverview> {
  const rows = await loadRows(reader, input.bangumi_id);
  return toOverview(input.bangumi_id, rows);
}

async function loadRows(reader: OverviewPointsReader, bangumiId: string): Promise<OverviewPointRow[]> {
  const rows = await reader.pointsForWork(bangumiId);
  if (rows.length > 0 || await reader.workExists(bangumiId)) return rows;
  throw new AnimeOverviewNotFoundError(bangumiId);
}

function toOverview(bangumiId: string, rows: OverviewPointRow[]): AnimeOverview {
  return {
    bangumi_id: bangumiId,
    points_length: rows.length,
    circles: buildCircles(rows),
    scenes: buildScenes(rows),
    sample_itineraries: buildSampleItineraries(rows),
  };
}

/** Group rows by non-empty region (city), preserving id order within a region. */
function groupByRegion(rows: OverviewPointRow[]): Map<string, OverviewPointRow[]> {
  const groups = new Map<string, OverviewPointRow[]>();
  for (const row of rows) {
    if (!row.city) continue;
    const group = groups.get(row.city) ?? [];
    group.push(row);
    groups.set(row.city, group);
  }
  return groups;
}

function buildCircles(rows: OverviewPointRow[]): AnimeOverviewCircle[] {
  const circles: AnimeOverviewCircle[] = [];
  for (const [region, members] of groupByRegion(rows)) {
    const count = members.length;
    const lat = members.reduce((sum, row) => sum + row.latitude, 0) / count;
    const lng = members.reduce((sum, row) => sum + row.longitude, 0) / count;
    circles.push({ region, count, lat, lng });
  }
  return circles;
}

function buildScenes(rows: OverviewPointRow[]): AnimeScene[] {
  const scenes = clusterByLocation(rows, CLUSTER_RADIUS_M).map(toScene);
  return scenes
    .sort((a, b) => b.shot_count - a.shot_count)
    .slice(0, SCENE_LIMIT);
}

function toScene(cluster: LocationCluster<OverviewPointRow>): AnimeScene {
  const rep = representative(cluster);
  return {
    id: rep.id,
    name: rep.name,
    screenshot_url: rep.image,
    shot_count: cluster.photoCount,
    lat: rep.latitude,
    lng: rep.longitude,
    city: rep.city ?? undefined,
  };
}

function representative(cluster: LocationCluster<OverviewPointRow>): OverviewPointRow {
  const withImage = cluster.points.find((point) => point.image);
  if (withImage) return withImage;
  const rep = cluster.points.find((point) => point.id === cluster.clusterId);
  if (!rep) throw new Error(`cluster ${cluster.clusterId} has no representative row`);
  return rep;
}

function buildSampleItineraries(rows: OverviewPointRow[]): AnimeSampleItinerary[] {
  return [...groupByRegion(rows).entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, SAMPLE_ITINERARY_REGION_LIMIT)
    .map(([region, members]) => ({
      region,
      point_ids: members.slice(0, SAMPLE_ITINERARY_POINT_CAP).map((row) => row.id),
    }));
}
