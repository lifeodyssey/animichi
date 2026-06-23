import { describe, expect, it } from "vitest";
import { haversine } from "../src/lib/geo";
import { clusterByLocation } from "../src/lib/clustering";

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

describe("clusterByLocation (clustering.ts)", () => {
  it("returns [] for empty input", () => {
    expect(clusterByLocation<P>([])).toEqual([]);
  });

  it("merges two points within 50m and keeps a far point separate", () => {
    // a-b ~= 33.36m (< 50), a-c ~= 1111.95m (>> 50)
    const pts: P[] = [
      { id: "a", latitude: 35.0, longitude: 135.0 },
      { id: "b", latitude: 35.0003, longitude: 135.0 },
      { id: "c", latitude: 35.01, longitude: 135.0 },
    ];
    const clusters = clusterByLocation(pts);
    // Python F1: [{cluster_id:'a', center_lat:35.000150000000005, photo:2}, {cluster_id:'c', center_lat:35.01, photo:1}]
    expect(clusters.map((c) => c.clusterId)).toEqual(["a", "c"]);
    expect(clusters[0]!.photoCount).toBe(2);
    expect(clusters[0]!.centerLat).toBeCloseTo(35.000150000000005, 12);
    expect(clusters[0]!.centerLng).toBe(135.0);
    expect(clusters[0]!.points.map((p) => p.id)).toEqual(["a", "b"]);
    expect(clusters[1]!.photoCount).toBe(1);
    expect(clusters[1]!.centerLat).toBe(35.01);
    expect(clusters[1]!.points.map((p) => p.id)).toEqual(["c"]);
  });

  it("merges a transitive chain even when the endpoints exceed the radius (union-find)", () => {
    // a-b ~= 33m (<50), b-c ~= 33m (<50), but a-c ~= 66.7m (>50).
    // Pairwise-only grouping would split a from c; union-find merges all three.
    const pts: P[] = [
      { id: "a", latitude: 35.0, longitude: 135.0 },
      { id: "b", latitude: 35.0003, longitude: 135.0 },
      { id: "c", latitude: 35.0006, longitude: 135.0 },
    ];
    const clusters = clusterByLocation(pts);
    // Python F2: single cluster {cluster_id:'a', center_lat:35.0003, photo:3}
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.clusterId).toBe("a");
    expect(clusters[0]!.photoCount).toBe(3);
    expect(clusters[0]!.centerLat).toBeCloseTo(35.0003, 12);
    expect(clusters[0]!.points.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps all-distant points separate, sorted by clusterId", () => {
    // Input order z, y, x — Python sorts output by cluster_id -> x, y, z.
    const pts: P[] = [
      { id: "z", latitude: 35.0, longitude: 135.0 },
      { id: "y", latitude: 36.0, longitude: 136.0 },
      { id: "x", latitude: 37.0, longitude: 137.0 },
    ];
    const clusters = clusterByLocation(pts);
    expect(clusters.map((c) => c.clusterId)).toEqual(["x", "y", "z"]);
    expect(clusters.every((c) => c.photoCount === 1)).toBe(true);
    expect(clusters[0]!.centerLat).toBe(37.0);
    expect(clusters[2]!.centerLat).toBe(35.0);
  });

  it("uses the alphabetically-first id as clusterId regardless of input order", () => {
    // Same coords -> one cluster; ids unsorted on input.
    const pts: P[] = [
      { id: "m", latitude: 35.0, longitude: 135.0 },
      { id: "a", latitude: 35.0001, longitude: 135.0 },
      { id: "z", latitude: 35.0002, longitude: 135.0 },
    ];
    const clusters = clusterByLocation(pts);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.clusterId).toBe("a");
    // member order preserved from input
    expect(clusters[0]!.points.map((p) => p.id)).toEqual(["m", "a", "z"]);
  });

  it("respects a custom radius", () => {
    // a-c ~= 66.7m: excluded at default 50m, included at 100m.
    const pts: P[] = [
      { id: "a", latitude: 35.0, longitude: 135.0 },
      { id: "c", latitude: 35.0006, longitude: 135.0 },
    ];
    expect(clusterByLocation(pts, 50)).toHaveLength(2);
    expect(clusterByLocation(pts, 100)).toHaveLength(1);
  });
});
