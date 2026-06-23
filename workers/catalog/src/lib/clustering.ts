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

/** Path-compressing find — mirrors Python `_find`. */
function find(parent: number[], i: number): number {
  let node = i;
  while (parent[node] !== node) {
    // path compression: point at grandparent
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- union-find indices bounded by n
    parent[node] = parent[parent[node]!]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- union-find indices bounded by n
    node = parent[node]!;
  }
  return node;
}

/** Union-by-rank — mirrors Python `_union`. */
function union(parent: number[], rank: number[], a: number, b: number): void {
  let ra = find(parent, a);
  let rb = find(parent, b);
  if (ra === rb) {
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- ra/rb are valid indices from find()
  if (rank[ra]! < rank[rb]!) {
    [ra, rb] = [rb, ra];
  }
  parent[rb] = ra;
  if (rank[ra] === rank[rb]) {
    rank[ra] = (rank[ra] ?? 0) + 1;
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
  const n = points.length;
  if (n === 0) {
    return [];
  }

  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array<number>(n).fill(0);

  // O(n^2) pairwise comparison, same iteration order as Python (i, then j>i).
  for (let i = 0; i < n; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index bounded by loop [0, n)
    pairUnion(parent, rank, points, n, points[i]!, i, radiusM);
  }

  return buildClusters(points, parent);
}

function pairUnion<P extends ClusterablePoint>(
  parent: number[],
  rank: number[],
  points: P[],
  n: number,
  pi: P,
  i: number,
  radiusM: number,
): void {
  for (let j = i + 1; j < n; j += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index bounded by loop [0, n)
    const pj = points[j]!;
    if (haversine(pi.latitude, pi.longitude, pj.latitude, pj.longitude) < radiusM) {
      union(parent, rank, i, j);
    }
  }
}

function buildClusters<P extends ClusterablePoint>(
  points: P[],
  parent: number[],
): LocationCluster<P>[] {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < points.length; i += 1) {
    const root = find(parent, i);
    const bucket = groups.get(root);
    if (bucket) {
      bucket.push(i);
    } else {
      groups.set(root, [i]);
    }
  }

  const clusters: LocationCluster<P>[] = [];
  for (const indices of groups.values()) {
    clusters.push(makeCluster(points, indices));
  }
  clusters.sort((a, b) => a.clusterId.localeCompare(b.clusterId));
  return clusters;
}

function makeCluster<P extends ClusterablePoint>(
  points: P[],
  indices: number[],
): LocationCluster<P> {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- indices are valid array positions
  const members = indices.map((i) => points[i]!);
  const sumLat = members.reduce((acc, p) => acc + p.latitude, 0);
  const sumLng = members.reduce((acc, p) => acc + p.longitude, 0);
  const ids = members.map((p) => p.id).sort((a, b) => a.localeCompare(b));
  return {
    centerLat: sumLat / members.length,
    centerLng: sumLng / members.length,
    points: members,
    photoCount: members.length,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- ids is non-empty (at least one member)
    clusterId: ids[0]!,
  };
}
