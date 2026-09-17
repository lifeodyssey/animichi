/**
 * Duplicate spot detection (X15 #285).
 *
 * The DuplicateSpots specification: two spots of the SAME episode whose
 * coordinates lie strictly within DEDUPE_RADIUS_M of each other are the same
 * spot recorded twice, and only one may reach the public snapshot. A row
 * with an unknown (null) episode carries no episode identity to share, so it
 * never merges.
 *
 * The merge is deterministic and O(n): within each episode the rows are
 * clustered transitively at the dedupe radius by the domain cluster kernel
 * (`clusterByLocation`, the same union-find the scenes use), and every
 * multi-row group collapses to its FIRST row in input order — the publish
 * export orders points by id, so the representative is stable.
 */
import { clusterByLocation, type LocationCluster } from "../domain/clustering/cluster";
import { haversine } from "../domain/geo";
import type { SpotCoordinates } from "./spot-coordinates";

/**
 * The dedupe radius in meters (initial value from card #285): two distinct
 * pilgrimage spots of one episode essentially never sit closer than a city
 * block, while a double-recorded scene does. Kept below the 50 m scene
 * cluster radius so a merged pair also reads as one scene on public pages.
 */
export const DEDUPE_RADIUS_M = 25;

/** The row fields the DuplicateSpots specification reads. */
export interface EpisodeSpot {
  readonly id: string;
  readonly episode: number | null;
}

/** An episode spot with its position. */
export type LocatedEpisodeSpot = EpisodeSpot & SpotCoordinates;

/** One collapsed duplicate group: the kept representative and the rows merged away. */
export interface DuplicateSpotMerge {
  readonly keptSpotId: string;
  readonly mergedSpotIds: readonly string[];
}

/** Whether two spots are duplicates: same known episode, within the radius. */
export function areDuplicateSpots(a: LocatedEpisodeSpot, b: LocatedEpisodeSpot): boolean {
  return a.episode !== null && a.episode === b.episode
    && haversine(a.latitude, a.longitude, b.latitude, b.longitude) < DEDUPE_RADIUS_M;
}

/** The merge outcome: publishable rows (input order preserved) + the merge reports. */
export interface SpotMerge<T extends LocatedEpisodeSpot> {
  readonly publishable: readonly T[];
  readonly merges: readonly DuplicateSpotMerge[];
}

/** Collapse same-episode duplicate rows into their first occurrence. */
export function mergeDuplicateSpots<T extends LocatedEpisodeSpot>(rows: readonly T[]): SpotMerge<T> {
  const merges = duplicateMerges(rows);
  const mergedAway = new Set(merges.flatMap((merge) => merge.mergedSpotIds));
  return { publishable: rows.filter((row) => !mergedAway.has(row.id)), merges };
}

/** Multi-row duplicate groups over the same-episode partitions, as merge reports. */
function duplicateMerges(rows: readonly LocatedEpisodeSpot[]): readonly DuplicateSpotMerge[] {
  return [...sameEpisodeGroups(rows).values()]
    .flatMap((members) => clusterByLocation(members, DEDUPE_RADIUS_M))
    .filter((cluster) => cluster.points.length > 1)
    .map(mergeReport);
}

/** Partition rows by episode; unknown episodes are excluded (never merged). */
function sameEpisodeGroups(rows: readonly LocatedEpisodeSpot[]): Map<number, LocatedEpisodeSpot[]> {
  const groups = new Map<number, LocatedEpisodeSpot[]>();
  for (const row of rows) {
    if (row.episode === null) continue;
    const group = groups.get(row.episode) ?? [];
    group.push(row);
    groups.set(row.episode, group);
  }
  return groups;
}

/** The cluster's first member (input order) is kept; the rest are merged away. */
function mergeReport(cluster: LocationCluster<LocatedEpisodeSpot>): DuplicateSpotMerge {
  const kept = cluster.points[0];
  if (kept === undefined) throw new Error("cluster kernel returned an empty cluster");
  return { keptSpotId: kept.id, mergedSpotIds: cluster.points.slice(1).map((row) => row.id) };
}
