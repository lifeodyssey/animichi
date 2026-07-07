import { describe, expect, it } from "vitest";
import type { LocationCluster } from "../src/lib/clustering";
import {
  buildTimedItinerary,
  computeDwellMinutes,
  orderNearestNeighbor,
} from "../src/lib/route";

// Fixture: three clusters on a meridian near 35.0N, 135.0E.
// Adjacent gap a-b == b-c == 111.1949 m.

interface RawPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

function mk(id: string, lat: number, n: number, name: string): LocationCluster<RawPoint> {
  return {
    centerLat: lat,
    centerLng: 135.0,
    points: [{ id, name, latitude: lat, longitude: 135.0 }],
    photoCount: n,
    clusterId: id,
  };
}

const fixture = (): LocationCluster<RawPoint>[] => [
  mk("c", 35.002, 2, "Cafe"),
  mk("a", 35.0, 3, "Shrine"),
  mk("b", 35.001, 1, "Bridge"),
];

describe("orderNearestNeighbor (route.ts)", () => {
  it("returns the input unchanged for 0 or 1 clusters", () => {
    expect(orderNearestNeighbor([])).toEqual([]);
    const one = [mk("a", 35.0, 1, "Solo")];
    expect(orderNearestNeighbor(one).map((c) => c.clusterId)).toEqual(["a"]);
  });

  it("starts at the alphabetically-first id when no origin (Python: a,b,c)", () => {
    expect(orderNearestNeighbor(fixture()).map((c) => c.clusterId)).toEqual(["a", "b", "c"]);
  });

  it("starts nearest to origin, then hops nearest-neighbor (Python: c,b,a)", () => {
    const ordered = orderNearestNeighbor(fixture(), { lat: 35.0025, lng: 135.0 });
    expect(ordered.map((c) => c.clusterId)).toEqual(["c", "b", "a"]);
  });
});

describe("computeDwellMinutes (route.ts)", () => {
  // Python compute_dwell_minutes for photo_count 1,2,3:
  //   chill -> [12,12,14], normal -> [8,8,9], packed -> [5,5,5]
  it("matches Python dwell for chill pacing", () => {
    expect([1, 2, 3].map((n) => computeDwellMinutes(n, "chill"))).toEqual([12, 12, 14]);
  });
  it("matches Python dwell for normal pacing", () => {
    expect([1, 2, 3].map((n) => computeDwellMinutes(n, "normal"))).toEqual([8, 8, 9]);
  });
  it("matches Python dwell for packed pacing", () => {
    expect([1, 2, 3].map((n) => computeDwellMinutes(n, "packed"))).toEqual([5, 5, 5]);
  });
});

describe("buildTimedItinerary — normal pacing, no origin", () => {
  const it_ = buildTimedItinerary(fixture(), { startTime: "09:00", pacing: "normal" });

  it("orders stops a,b,c with detoured walk arrivals", () => {
    expect(it_.stops.map((s) => [s.cluster_id, s.arrive, s.depart, s.dwell_minutes])).toEqual([
      ["a", "09:00", "09:09", 9],
      ["b", "09:11", "09:19", 8],
      ["c", "09:21", "09:29", 8],
    ]);
  });

  it("uses the first point's name as the stop name", () => {
    expect(it_.stops.map((s) => s.name)).toEqual(["Shrine", "Bridge", "Cafe"]);
  });

  it("emits walk legs with detoured duration + raw distance", () => {
    expect(it_.legs).toEqual([
      { from_id: "a", to_id: "b", mode: "walk", duration_minutes: 2, distance_m: 111.2 },
      { from_id: "b", to_id: "c", mode: "walk", duration_minutes: 2, distance_m: 111.2 },
    ]);
  });

  it("matches totals + envelope", () => {
    expect(it_.total_minutes).toBe(29);
    expect(it_.total_distance_m).toBe(222.4);
    expect(it_.spot_count).toBe(3);
    expect(it_.pacing).toBe("normal");
    expect(it_.start_time).toBe("09:00");
  });

  it("has monotonically non-decreasing arrive/depart times", () => {
    const times = it_.stops.flatMap((s) => [s.arrive, s.depart]);
    const sorted = [...times].sort();
    expect(times).toEqual(sorted);
  });
});

describe("buildTimedItinerary — packed pacing, origin near c", () => {
  const it_ = buildTimedItinerary(fixture(), {
    startTime: "10:30",
    pacing: "packed",
    origin: { lat: 35.0025, lng: 135.0 },
  });

  it("orders c,b,a with Python times (start 10:30, dwell 5 each)", () => {
    expect(it_.stops.map((s) => [s.cluster_id, s.arrive, s.depart, s.dwell_minutes])).toEqual([
      ["c", "10:30", "10:35", 5],
      ["b", "10:36", "10:41", 5],
      ["a", "10:42", "10:47", 5],
    ]);
  });

  it("matches Python legs + totals for packed pacing", () => {
    expect(it_.legs.map((l) => [l.from_id, l.to_id, l.duration_minutes, l.distance_m])).toEqual([
      ["c", "b", 1, 111.2],
      ["b", "a", 1, 111.2],
    ]);
    expect(it_.total_minutes).toBe(17);
    expect(it_.total_distance_m).toBe(222.4);
    expect(it_.pacing).toBe("packed");
  });
});

describe("buildTimedItinerary — walking detour coefficient", () => {
  const far = (): LocationCluster<RawPoint>[] => [
    mk("a", 35.0, 2, "Start"),
    mk("b", 35.01, 2, "End"),
  ];

  it("pins x1.3 walking duration while keeping distance raw for each pacing", () => {
    const cases = [
      ["chill", 22, 46],
      ["normal", 18, 34],
      ["packed", 14, 24],
    ] as const;
    const actual = cases.map(([pacing]) => {
      const r = buildTimedItinerary(far(), { pacing });
      return [pacing, r.legs.at(0)?.duration_minutes, r.legs.at(0)?.distance_m, r.total_minutes];
    });
    expect(actual).toEqual([
      ["chill", 22, 1111.9, 46],
      ["normal", 18, 1111.9, 34],
      ["packed", 14, 1111.9, 24],
    ]);
  });
});

describe("buildTimedItinerary — edge cases (Python parity)", () => {
  it("returns an empty envelope for no clusters", () => {
    const r = buildTimedItinerary([], { pacing: "chill" });
    expect(r).toEqual({
      stops: [],
      legs: [],
      total_minutes: 0,
      total_distance_m: 0,
      pacing: "chill",
      start_time: "09:00",
    });
  });

  it("falls back to normal pacing for an unknown value", () => {
    expect(buildTimedItinerary(fixture(), { pacing: "zoom" }).pacing).toBe("normal");
    expect(buildTimedItinerary([], { pacing: "zoom" }).pacing).toBe("normal");
  });

  it("handles a single cluster: no legs, total_minutes == dwell", () => {
    const r = buildTimedItinerary([mk("a", 35.0, 2, "Solo")], { pacing: "normal" });
    expect(r.legs).toEqual([]);
    expect(r.total_minutes).toBe(8);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test data known to exist
    expect(r.stops[0]!.depart).toBe("09:08");
    expect(r.total_distance_m).toBe(0);
  });

  it("throws when given more than 50 clusters", () => {
    const many = Array.from({ length: 51 }, (_, i) =>
      mk(`p${String(i).padStart(3, "0")}`, 35 + i * 0.001, 1, `P${String(i)}`),
    );
    expect(() => buildTimedItinerary(many)).toThrow(/max 50/);
  });
});
