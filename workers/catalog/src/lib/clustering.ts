/**
 * Deterministic location clustering via union-find.
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

/** Mutable union-find node; parent links replace unchecked numeric indexing. */
class UnionNode {
  parent: UnionNode = this;
  rank = 0;
}

interface PointNode<P extends ClusterablePoint> {
  point: P;
  node: UnionNode;
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
  pairUnion(entries, radiusM);
  return buildClusters(entries);
}

function pairUnion<P extends ClusterablePoint>(
  entries: PointNode<P>[],
  radiusM: number,
): void {
  // O(n^2) pairwise comparison, same iteration order as Python (i, then j>i).
  for (const [index, left] of entries.entries()) {
    for (const right of entries.slice(index + 1)) {
      unionIfClose(left, right, radiusM);
    }
  }
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
