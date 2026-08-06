import { describe, expect, it } from "vitest";
import { haversine } from "../src/domain/geo";
import { clusterByLocation } from "../src/domain/clustering/cluster";

/**
 * Parity tests: the TS port of the Python deterministic kernels
 * (`backend/agents/geo_utils.py::haversine_distance` and
 * `backend/agents/route_optimizer.py::cluster_by_location`).
 *
 * Expected values were captured by running the Python implementations directly
 * (see card W1-2 notes), so these assert behavioural PARITY, not just internal
 * consistency. Named *.worker.test.ts so the existing vitest-pool-workers
 * config picks it up; the logic is pure and runtime-agnostic.
 */

interface P {
  id: string;
  latitude: number;
  longitude: number;
}

describe("haversine (geo.ts)", () => {
  it("matches Python for 1 degree of latitude", () => {
    // Python haversine_distance(0,0,1,0) === 111194.92664455874
    expect(haversine(0, 0, 1, 0)).toBeCloseTo(111194.92664455874, 6);
  });

  it("matches Python for a known city pair (Tokyo St -> Skytree)", () => {
    // Python haversine_distance(35.681236,139.767125,35.71006,139.8107) === 5075.1279058492155
    expect(haversine(35.681236, 139.767125, 35.71006, 139.8107)).toBeCloseTo(
      5075.1279058492155,
      6,
    );
  });

  it("is symmetric and zero for identical points", () => {
    const d = haversine(35.0, 135.0, 35.0003, 135.0);
    expect(d).toBeCloseTo(haversine(35.0003, 135.0, 35.0, 135.0), 9);
    expect(haversine(35.0, 135.0, 35.0, 135.0)).toBe(0);
  });
});

function assertMergesCloseKeepsFar(): void {
  const clusters = clusterByLocation(ptsAt(["a", 35.0, 135.0], ["b", 35.0003, 135.0], ["c", 35.01, 135.0]));
  expect(clusters.map((c) => c.clusterId)).toEqual(["a", "c"]);
  assertCluster(clusters, 0, 2, 35.000150000000005, ["a", "b"]);
  expect(clusters.at(0)?.centerLng).toBe(135.0);
  assertCluster(clusters, 1, 1, 35.01, ["c"]);
}

function assertTransitiveChain(): void {
  const clusters = clusterByLocation(ptsAt(["a", 35.0, 135.0], ["b", 35.0003, 135.0], ["c", 35.0006, 135.0]));
  expect(clusters).toHaveLength(1);
  expect(clusters.at(0)?.clusterId).toBe("a");
  assertCluster(clusters, 0, 3, 35.0003, ["a", "b", "c"]);
}

function assertAllDistantSortedById(): void {
  const clusters = clusterByLocation(ptsAt(["z", 35.0, 135.0], ["y", 36.0, 136.0], ["x", 37.0, 137.0]));
  expect(clusters.map((c) => c.clusterId)).toEqual(["x", "y", "z"]);
  expect(clusters.every((c) => c.photoCount === 1)).toBe(true);
  expect(clusters.at(0)?.centerLat).toBe(37.0);
  expect(clusters.at(2)?.centerLat).toBe(35.0);
}

function assertAlphabeticalClusterId(): void {
  const clusters = clusterByLocation(ptsAt(["m", 35.0, 135.0], ["a", 35.0001, 135.0], ["z", 35.0002, 135.0]));
  expect(clusters).toHaveLength(1);
  expect(clusters.at(0)?.clusterId).toBe("a");
  expect(clusters.at(0)?.points.map((p) => p.id)).toEqual(["m", "a", "z"]);
}

function ptsAt(...rows: [string, number, number][]): P[] {
  return rows.map(([id, latitude, longitude]) => ({ id, latitude, longitude }));
}

function assertCluster(clusters: ReturnType<typeof clusterByLocation<P>>, index: number, photoCount: number, lat: number, ids: string[]): void {
  expect(clusters.at(index)?.photoCount).toBe(photoCount);
  expect(clusters.at(index)?.centerLat).toBeCloseTo(lat, 12);
  expect(clusters.at(index)?.points.map((p) => p.id)).toEqual(ids);
}

describe("clusterByLocation (clustering.ts)", () => {
  it("returns [] for empty input", () => {
    expect(clusterByLocation<P>([])).toEqual([]);
  });

  // Python F1: [{cluster_id:'a', center_lat:35.000150000000005, photo:2}, {cluster_id:'c', center_lat:35.01, photo:1}]
  it("merges two points within 50m and keeps a far point separate", assertMergesCloseKeepsFar);

  // Python F2: single cluster {cluster_id:'a', center_lat:35.0003, photo:3}
  it("merges a transitive chain even when the endpoints exceed the radius (union-find)", assertTransitiveChain);

  it("keeps all-distant points separate, sorted by clusterId", assertAllDistantSortedById);

  it("uses the alphabetically-first id as clusterId regardless of input order", assertAlphabeticalClusterId);

  it("respects a custom radius", () => {
    // a-c ~= 66.7m: excluded at default 50m, included at 100m.
    const pts: P[] = [
      { id: "a", latitude: 35.0, longitude: 135.0 },
      { id: "c", latitude: 35.0006, longitude: 135.0 },
    ];
    expect(clusterByLocation(pts, 50)).toHaveLength(2);
    expect(clusterByLocation(pts, 100)).toHaveLength(1);
  });

  it("merges a higher-rank tree under a lower-rank one (union-by-rank swap)", () => {
    // a-b chain lifts a's rank to 1. c stays rank 0 (267m from a, 222m from
    // b — outside the 200m radius). When e bridges the chain and c, the
    // union(c, e) call finds c's root at rank 0 against e's root (a) at
    // rank 1, forcing the `ra.rank < rb.rank` swap branch.
    const pts: P[] = [
      { id: "a", latitude: 35.0, longitude: 135.0 },
      { id: "b", latitude: 35.0004, longitude: 135.0 },
      { id: "c", latitude: 35.0024, longitude: 135.0 },
      { id: "e", latitude: 35.0016, longitude: 135.0 },
    ];
    expect(clusterByLocation(pts, 200)).toHaveLength(1);
  });
});
