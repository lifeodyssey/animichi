import { haversine } from "./geo";
import type { GeocodeCandidate, GeocodeKind, GeocodeSource } from "../types";

const CLUSTER_RADIUS_M = 12_000;
export const FUZZY_SIMILARITY_THRESHOLD = 0.4;
export const FUZZY_RESULT_LIMIT = 10;
const KIND_ORDER: Readonly<Record<GeocodeKind, number>> = {
  station: 5,
  city: 4,
  ward: 3,
  landmark: 2,
  prefecture: 1,
};
const KIND_RADIUS_M: Readonly<Record<GeocodeKind, number>> = {
  station: 5_000,
  city: 10_000,
  ward: 5_000,
  landmark: 5_000,
  prefecture: 10_000,
};

export interface GeocodeHit {
  id: string;
  name: string;
  kind: GeocodeKind;
  latitude: number;
  longitude: number;
  source: GeocodeSource;
  pref: string | null;
  priority: number;
  exact: boolean;
}

export interface CollapsedGeocodeCandidate extends GeocodeCandidate {
  effective_radius_m: number;
}

function find(parent: number[], index: number): number {
  let node = index;
  while (parent[node] !== node) {
    parent[node] = parent[parent[node] ?? node] ?? node;
    node = parent[node] ?? node;
  }
  return node;
}

function union(parent: number[], left: number, right: number): void {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);
  if (leftRoot === rightRoot) return;
  parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
}

function connectNearby(hits: GeocodeHit[], parent: number[]): void {
  for (let left = 0; left < hits.length; left += 1) {
    connectFrom(hits, parent, left);
  }
}

function connectFrom(hits: GeocodeHit[], parent: number[], left: number): void {
  const source = hits[left];
  if (!source) return;
  for (let right = left + 1; right < hits.length; right += 1) {
    const target = hits[right];
    if (target && nearby(source, target)) union(parent, left, right);
  }
}

function nearby(left: GeocodeHit, right: GeocodeHit): boolean {
  return haversine(left.latitude, left.longitude, right.latitude, right.longitude) <= CLUSTER_RADIUS_M;
}

function representativeOrder(a: GeocodeHit, b: GeocodeHit): number {
  return KIND_ORDER[b.kind] - KIND_ORDER[a.kind] || b.priority - a.priority || a.id.localeCompare(b.id);
}

function clusterOrder(a: GeocodeHit, b: GeocodeHit): number {
  return Number(b.exact) - Number(a.exact) || b.priority - a.priority || a.id.localeCompare(b.id);
}

function collapseMembers(members: GeocodeHit[]): CollapsedGeocodeCandidate {
  const representative = clusterRepresentative(members);
  return {
    id: representative.id,
    label: representative.pref ? `${representative.name}(${representative.pref})` : representative.name,
    name: representative.name,
    lat: representative.latitude,
    lng: representative.longitude,
    kind: representative.kind,
    source: representative.source,
    effective_radius_m: Math.max(...members.map((member) => KIND_RADIUS_M[member.kind])),
  };
}

function clusterRepresentative(members: GeocodeHit[]): GeocodeHit {
  const representative = [...members].sort(representativeOrder)[0];
  if (!representative) throw new Error("geocode cluster cannot be empty");
  return representative;
}

/** Collapse one lookup tier with 12km single-link union-find clustering. */
export function collapseGeocodeHits(hits: GeocodeHit[], limit: number): CollapsedGeocodeCandidate[] {
  const parent = hits.map((_, index) => index);
  connectNearby(hits, parent);
  const groups = new Map<number, GeocodeHit[]>();
  hits.forEach((hit, index) => {
    const root = find(parent, index);
    groups.set(root, [...(groups.get(root) ?? []), hit]);
  });
  return [...groups.values()]
    .sort((a, b) => clusterOrder(clusterRepresentative(a), clusterRepresentative(b)))
    .map(collapseMembers)
    .slice(0, limit);
}
