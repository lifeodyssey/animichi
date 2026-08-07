import type { LatLng } from "@animichi/contract";

/** C3a shows at most this many spot cards (spec-chat-page-states §C3a). */
export const TOP_SPOT_COUNT = 6;
/** The static map never draws more pins than this (spec-chat-page-states §C3a). */
export const MAX_MAP_PINS = 50;
/** C3b threshold: cluster link distance and the max single-cluster envelope, in km. */
export const CLUSTER_SPAN_KM = 50;

/** One search result spot, normalized from a streamed row. */
export interface SearchSpot {
  readonly id: string;
  readonly name: string;
  readonly screenshotUrl?: string;
  readonly ep?: number;
  readonly city?: string;
  readonly coord?: LatLng;
}

/** A spot that carries usable coordinates and can be placed on the map. */
export interface LocatedSpot extends SearchSpot {
  readonly coord: LatLng;
}

/** A geographic cluster of located spots with its centroid and majority city. */
export interface SpotCluster {
  readonly spots: readonly LocatedSpot[];
  readonly center: LatLng;
  readonly city?: string;
}

/** Which C3 shape the search result renders (spec-chat-page-states §C3a/C3b). */
export type SearchMapView =
  | { readonly kind: "empty" }
  | { readonly kind: "single"; readonly cluster: SpotCluster }
  | { readonly kind: "multi"; readonly clusters: readonly SpotCluster[] };

/** Loose row shape as streamed: coordinates and episode arrive under two names. */
export interface SpotRowLike {
  readonly id?: string;
  readonly name?: string;
  readonly lat?: number;
  readonly lng?: number;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly screenshot_url?: string;
  readonly ep?: number;
  readonly episode?: number;
  readonly city?: string;
}

function coordOf(row: SpotRowLike): LatLng | undefined {
  const lat = row.lat ?? row.latitude;
  const lng = row.lng ?? row.longitude;
  if (lat === undefined || lng === undefined) return undefined;
  return { lat, lng };
}

/** Upstream never omits these fields — it sends sentinels. `screenshot_url` is a
 * required string that the catalog worker fills with `""` when there is no image
 * (`r.image ?? ""`), and `episode` carries pydantic's `-1` unknown-marker. Both
 * arrive here via the agent's full `model_dump()`, so an `=== undefined` check
 * would never fire in production even though it passes against hand-written
 * fixtures. Normalize the sentinels to `undefined` once, here. */
function toSearchSpot(row: SpotRowLike, index: number): SearchSpot {
  const id = row.id ?? row.name ?? `spot-${String(index)}`;
  const rawEp = row.ep ?? row.episode;
  const ep = rawEp !== undefined && rawEp >= 0 ? rawEp : undefined;
  // Not `??`: the sentinel is the empty string, which `??` passes straight through.
  const screenshotUrl = row.screenshot_url === "" ? undefined : row.screenshot_url;
  return { id, name: row.name ?? "", screenshotUrl, ep, city: row.city, coord: coordOf(row) };
}

export function toSearchSpots(rows: readonly SpotRowLike[]): readonly SearchSpot[] {
  return rows.map((row, index) => toSearchSpot(row, index));
}

export function locatedSpots(spots: readonly SearchSpot[]): readonly LocatedSpot[] {
  return spots.flatMap((spot) => (spot.coord ? [{ ...spot, coord: spot.coord }] : []));
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle (haversine) distance between two coordinates, in km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const sinLat = Math.sin(toRadians(b.lat - a.lat) / 2);
  const sinLng = Math.sin(toRadians(b.lng - a.lng) / 2);
  const h = sinLat * sinLat + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

interface ClusterDraft {
  spots: LocatedSpot[];
  latSum: number;
  lngSum: number;
}

function draftCenter(draft: ClusterDraft): LatLng {
  const n = draft.spots.length;
  return { lat: draft.latSum / n, lng: draft.lngSum / n };
}

function addToDraft(draft: ClusterDraft, spot: LocatedSpot): void {
  draft.spots.push(spot);
  draft.latSum += spot.coord.lat;
  draft.lngSum += spot.coord.lng;
}

function placeSpot(drafts: ClusterDraft[], spot: LocatedSpot): void {
  const near = drafts.find((draft) => distanceKm(draftCenter(draft), spot.coord) <= CLUSTER_SPAN_KM);
  if (near) {
    addToDraft(near, spot);
    return;
  }
  drafts.push({ spots: [spot], latSum: spot.coord.lat, lngSum: spot.coord.lng });
}

function majorityCity(spots: readonly LocatedSpot[]): string | undefined {
  const counts = new Map<string, number>();
  for (const spot of spots) {
    if (spot.city) counts.set(spot.city, (counts.get(spot.city) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0];
}

function finishDraft(draft: ClusterDraft): SpotCluster {
  return { spots: draft.spots, center: draftCenter(draft), city: majorityCity(draft.spots) };
}

/** Greedy centroid clustering: a spot joins the first cluster within 50km. */
export function clusterSpots(spots: readonly LocatedSpot[]): readonly SpotCluster[] {
  const drafts: ClusterDraft[] = [];
  for (const spot of spots) placeSpot(drafts, spot);
  return drafts.map(finishDraft);
}

/** Diagonal span of the bounding box around every located spot, in km. */
export function envelopeKm(spots: readonly LocatedSpot[]): number {
  const lats = spots.map((spot) => spot.coord.lat);
  const lngs = spots.map((spot) => spot.coord.lng);
  const southwest = { lat: Math.min(...lats), lng: Math.min(...lngs) };
  const northeast = { lat: Math.max(...lats), lng: Math.max(...lngs) };
  return distanceKm(southwest, northeast);
}

/** C3b when ≥2 clusters or a >50km envelope; otherwise C3a (spec §C3a/C3b). */
export function searchMapView(spots: readonly SearchSpot[]): SearchMapView {
  const located = locatedSpots(spots);
  const [first, ...rest] = clusterSpots(located);
  if (first === undefined) return { kind: "empty" };
  if (rest.length > 0 || envelopeKm(located) > CLUSTER_SPAN_KM) return { kind: "multi", clusters: [first, ...rest] };
  return { kind: "single", cluster: first };
}

function photoRank(spot: SearchSpot): number {
  return spot.screenshotUrl === undefined ? 1 : 0;
}

/** Top-6 cards: photo-carrying spots first, upstream (relevance) order preserved. */
export function topSpots(spots: readonly SearchSpot[]): readonly SearchSpot[] {
  return [...spots].sort((a, b) => photoRank(a) - photoRank(b)).slice(0, TOP_SPOT_COUNT);
}
