/**
 * Deterministic location clustering via a spatial grid and union-find.
 *
 * Faithful TS port of
 * `backend/agents/route_optimizer.py::cluster_by_location` (lines ~34-114),
 * including the `_find` (path compression) and `_union` (union-by-rank)
 * helpers. Pure logic — no I/O, no DB. Deterministic for a given input order.
 */

import { haversine } from "./geo";

/** A point to be clustered. Extra fields are preserved on output. */
export interface ClusterablePoint {
  id: string;
  latitude: number;
  longitude: number;
}

export interface LocationCluster<P extends ClusterablePoint = ClusterablePoint> {
  /** Arithmetic mean latitude of all member points. */
  centerLat: number;
  /** Arithmetic mean longitude of all member points. */
  centerLng: number;
  /** Member points, in original input order. */
  points: P[];
  /** Number of member points. */
  photoCount: number;
  /** Alphabetically-first member `id` (the Python tiebreak). */
  clusterId: string;
}

type NonEmpty<T> = [T, ...T[]];
type SpatialGrid<P extends ClusterablePoint> = Map<string, PointNode<P>[]>;

const EARTH_RADIUS_M = 6_371_000;
const OFFSETS = [-1, 0, 1] as const;
const NEIGHBOR_OFFSETS = OFFSETS.flatMap((x) =>
  OFFSETS.flatMap((y) => OFFSETS.map((z) => [x, y, z] as const)),
);

/** Mutable union-find node; parent links replace unchecked numeric indexing. */
class UnionNode {
  parent: UnionNode = this;
  rank = 0;
}

interface PointNode<P extends ClusterablePoint> {
  point: P;
  node: UnionNode;
}

interface SpatialCell {
  x: number;
  y: number;
  z: number;
}

/** Path-compressing find — mirrors Python `_find`. */
function find(node: UnionNode): UnionNode {
  let root = node;
  while (root.parent !== root) {
    // path compression: point at grandparent
    root.parent = root.parent.parent;
    root = root.parent;
  }
  return root;
}

/** Union-by-rank — mirrors Python `_union`. */
function union(a: UnionNode, b: UnionNode): void {
  let ra = find(a);
  let rb = find(b);
  if (ra === rb) {
    return;
  }
  if (ra.rank < rb.rank) {
    [ra, rb] = [rb, ra];
  }
  rb.parent = ra;
  if (ra.rank === rb.rank) {
    ra.rank += 1;
  }
}

/**
 * Group `points` into clusters where any two points within `radiusM` meters of
 * each other belong to the same cluster (transitively, via union-find).
 *
 * Output parity with Python:
 *  - `clusterId` is the alphabetically-first member `id`.
 *  - `centerLat` / `centerLng` are arithmetic means of member coordinates.
 *  - The returned list is sorted ascending by `clusterId`.
 *  - Points within each cluster keep their original input order.
 */
export function clusterByLocation<P extends ClusterablePoint>(
  points: P[],
  radiusM = 50,
): LocationCluster<P>[] {
  const entries = points.map((point) => ({ point, node: new UnionNode() }));
  if (radiusM > 0) spatialUnion(entries, radiusM);
  return buildClusters(entries);
}

function spatialUnion<P extends ClusterablePoint>(entries: PointNode<P>[], radiusM: number): void {
  const grid: SpatialGrid<P> = new Map();
  const cellSize = chordLength(radiusM);
  for (const entry of entries) addSpatialEntry(grid, entry, cellSize, radiusM);
}

function addSpatialEntry<P extends ClusterablePoint>(
  grid: SpatialGrid<P>, entry: PointNode<P>, cellSize: number, radiusM: number,
): void {
  const cell = spatialCell(entry.point, cellSize);
  for (const neighbor of neighborEntries(grid, cell)) unionIfClose(neighbor, entry, radiusM);
  insertEntry(grid, cellKey(cell), entry);
}

function chordLength(radiusM: number): number {
  const angle = Math.min(radiusM / EARTH_RADIUS_M, Math.PI);
  return 2 * Math.sin(angle / 2);
}

function spatialCell(point: ClusterablePoint, cellSize: number): SpatialCell {
  const lat = radians(point.latitude);
  const lng = radians(point.longitude);
  const cosLat = Math.cos(lat);
  return { x: Math.floor(cosLat * Math.cos(lng) / cellSize),
    y: Math.floor(cosLat * Math.sin(lng) / cellSize), z: Math.floor(Math.sin(lat) / cellSize) };
}

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function neighborEntries<P extends ClusterablePoint>(grid: SpatialGrid<P>, cell: SpatialCell): PointNode<P>[] {
  return NEIGHBOR_OFFSETS.flatMap(([x, y, z]) =>
    grid.get(cellKey({ x: cell.x + x, y: cell.y + y, z: cell.z + z })) ?? []);
}

function cellKey(cell: SpatialCell): string {
  return [cell.x, cell.y, cell.z].join(":");
}

function insertEntry<P extends ClusterablePoint>(grid: SpatialGrid<P>, key: string, entry: PointNode<P>): void {
  const bucket = grid.get(key);
  if (bucket) bucket.push(entry);
  else grid.set(key, [entry]);
}

function unionIfClose<P extends ClusterablePoint>(left: PointNode<P>, right: PointNode<P>, radiusM: number): void {
  const distance = haversine(left.point.latitude, left.point.longitude, right.point.latitude, right.point.longitude);
  if (distance < radiusM) union(left.node, right.node);
}

function buildClusters<P extends ClusterablePoint>(
  entries: PointNode<P>[],
): LocationCluster<P>[] {
  const groups = new Map<UnionNode, NonEmpty<P>>();
  for (const { point, node } of entries) {
    const root = find(node);
    const bucket = groups.get(root);
    if (bucket) {
      bucket.push(point);
    } else {
      groups.set(root, [point]);
    }
  }
  const clusters = [...groups.values()].map(makeCluster);
  clusters.sort((a, b) => a.clusterId.localeCompare(b.clusterId));
  return clusters;
}

function makeCluster<P extends ClusterablePoint>(
  members: NonEmpty<P>,
): LocationCluster<P> {
  const sumLat = members.reduce((acc, p) => acc + p.latitude, 0);
  const sumLng = members.reduce((acc, p) => acc + p.longitude, 0);
  const clusterId = members.reduce((id, point) => point.id.localeCompare(id) < 0 ? point.id : id, members[0].id);
  return {
    centerLat: sumLat / members.length,
    centerLng: sumLng / members.length,
    points: members,
    photoCount: members.length,
    clusterId,
  };
}
