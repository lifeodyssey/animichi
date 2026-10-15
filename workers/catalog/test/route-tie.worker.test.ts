import { describe, expect, it } from "vitest";
import type { LocationCluster } from "../src/domain/clustering/cluster";
import { haversine } from "../src/domain/geo";
import type { Origin } from "../src/domain/itinerary/plan";
import { orderNearestNeighbor } from "../src/domain/itinerary/plan";
import { tokyoSample } from "./fixtures/transit/tokyo-sample";

// SUT: the nearest-neighbour tie rule of the route-ordering kernel
// (`domain/itinerary/plan.ts`). One tie rule anchored on the unrounded
// nearest: within 0.01 m of the nearest, the lowest clusterId wins — decided
// by a linear scan, with no per-hop sort.

interface Point { id: string; latitude: number; longitude: number }

function cluster(id: string, lat: number, lng: number): LocationCluster<Point> {
  return { clusterId: id, centerLat: lat, centerLng: lng, photoCount: 1, points: [{ id, latitude: lat, longitude: lng }] };
}

// Haversine on a meridian is exactly R·|Δlat|, so a small latitude offset
// north of the walk start places a candidate at a known metre distance.
const START = { lat: 35.0, lng: 135.0 };

function north(metres: number): number {
  return START.lat + metres / (6_371_000 * (Math.PI / 180));
}

/** Walk ids from the start stop, given candidates as (id, metres north). */
function walkFrom(candidates: [string, number][]): string[] {
  const start = cluster("start", START.lat, START.lng);
  const rest = candidates.map(([id, metres]) => cluster(id, north(metres), START.lng));
  return orderNearestNeighbor([start, ...rest], START).map((c) => c.clusterId);
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("route kernel nearest-neighbour tie rule", () => {
  it("takes the lowest id within 0.01 m of the true nearest, not the rounded-sort winner", () => {
    // Candidates at 100.0000 m (z), 100.0049 m (a) and 100.0140 m (0): the
    // window around the unrounded nearest holds z and a, so the walk takes a.
    // The retired double tie (sort on 2-digit-rounded distance, then 1 cm
    // around the sort winner) took 0 — a step 1.4 cm past the nearest.
    expect(walkFrom([["z", 100.0], ["a", 100.0049], ["0", 100.0140]])).toEqual(["start", "a", "0", "z"]);
  });

  it("takes the lowest id when the true nearest already is the lowest id", () => {
    expect(walkFrom([["0", 100.0], ["z", 100.0049]])).toEqual(["start", "0", "z"]);
  });

  it("resolves an exact distance tie to the lowest id", () => {
    expect(walkFrom([["z", 100.0], ["a", 100.0]])).toEqual(["start", "a", "z"]);
  });

  it("returns the same walk for shuffled candidate input", () => {
    const candidates: [string, number][] = [["z", 100.0], ["a", 100.0049], ["0", 100.0140], ["m", 250.0]];
    const shuffled: [string, number][] = [["m", 250.0], ["z", 100.0], ["a", 100.0049], ["0", 100.0140]];
    expect(walkFrom(shuffled)).toEqual(walkFrom(candidates));
    expect(walkFrom(candidates)).toEqual(["start", "a", "0", "z", "m"]);
  });
});

// ---- Differential: one-rule pick vs the retired pick -----------------------
// The retired pre-#657 pick, verbatim: sort on the 2-digit-rounded distance,
// then re-pick the lowest id within 0.01 m of the sort winner's distance (not
// of the true nearest). Kept only so the one-rule walk can be proven
// identical on every existing fixture and a generated corpus.

function retiredRound(value: number, digits: number): number {
  const f = 10 ** digits;
  const scaled = value * f;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  if (diff < 0.5) return floor / f;
  if (diff > 0.5) return (floor + 1) / f;
  return (floor % 2 === 0 ? floor : floor + 1) / f;
}

function distanceTo(anchor: Origin | LocationCluster<Point>, c: LocationCluster<Point>): number {
  const lat = "centerLat" in anchor ? anchor.centerLat : anchor.lat;
  const lng = "centerLng" in anchor ? anchor.centerLng : anchor.lng;
  return haversine(lat, lng, c.centerLat, c.centerLng);
}

function retiredOrder(clusters: LocationCluster<Point>[], origin?: Origin): string[] {
  const byRoundedDistThenId = (anchor: Origin | LocationCluster<Point>, digits: number) =>
    (a: LocationCluster<Point>, b: LocationCluster<Point>): number => {
      const da = retiredRound(distanceTo(anchor, a), digits);
      const db = retiredRound(distanceTo(anchor, b), digits);
      return da !== db ? da - db : a.clusterId.localeCompare(b.clusterId);
    };
  const byId = (a: LocationCluster<Point>, b: LocationCluster<Point>): number => a.clusterId.localeCompare(b.clusterId);
  const seed = [...clusters].sort(origin ? byRoundedDistThenId(origin, 15) : byId);
  const [first, ...rest] = seed;
  if (!first) return [];
  const walk = [first.clusterId];
  let current = first;
  let remaining = rest;
  while (remaining.length > 0) {
    const sorted = [...remaining].sort(byRoundedDistThenId(current, 2));
    const best = sorted[0];
    if (!best) return walk;
    const bestDist = distanceTo(current, best);
    const next = sorted.reduce(
      (winner, c) => Math.abs(distanceTo(current, c) - bestDist) < 0.01 && c.clusterId.localeCompare(winner.clusterId) < 0 ? c : winner,
      best,
    );
    walk.push(next.clusterId);
    remaining = remaining.filter((c) => c !== next);
    current = next;
  }
  return walk;
}

interface OrderingView {
  clusters: LocationCluster<Point>[];
  origin?: Origin;
}

function stationCoordinate(id: string): [number, number] {
  const found = tokyoSample.stations.find((s) => s.station_id === id);
  if (!found) throw new Error(`Missing fixture station ${id}`);
  return [found.lat, found.lng];
}

/** The route-ordering fixtures: empty, single, meridian, far, transit pair — with and without an origin. */
function fixtureViews(): OrderingView[] {
  const meridian = [cluster("c", 35.002, 135.0), cluster("a", 35.0, 135.0), cluster("b", 35.001, 135.0)];
  const far = [cluster("a", 35.0, 135.0), cluster("b", 35.01, 135.0)];
  const single = [cluster("a", 35.0, 135.0)];
  const [shinjukuLat, shinjukuLng] = stationCoordinate("shinjuku-c");
  const [kichijojiLat, kichijojiLng] = stationCoordinate("kichijoji-c");
  const transitPair = [cluster("a", shinjukuLat, shinjukuLng), cluster("b", kichijojiLat, kichijojiLng)];
  const pools = [[], single, meridian, far, transitPair];
  const routeTestOrigin = { lat: 35.0025, lng: 135.0 };
  return pools.flatMap((clusters) => [{ clusters }, { clusters, origin: routeTestOrigin }]);
}

/** Seeded generated corpus: sizes 1-50, three rounds, with origin views. */
function corpusViews(): OrderingView[] {
  const rand = lcg(657);
  const views: OrderingView[] = [];
  for (let round = 0; round < 3; round += 1) {
    for (let size = 1; size <= 50; size += 1) {
      const draw = (i: number) =>
        cluster([round, size, i].map(String).join("."), 35 + (rand() - 0.5) * 0.2, 135 + (rand() - 0.5) * 0.2);
      const lead = draw(0);
      const clusters = [lead, ...Array.from({ length: size - 1 }, (_, i) => draw(i + 1))];
      views.push({ clusters }, { clusters, origin: { lat: lead.centerLat, lng: lead.centerLng } });
    }
  }
  return views;
}

function orderedIds(view: OrderingView): string[] {
  return orderNearestNeighbor(view.clusters, view.origin).map((c) => c.clusterId);
}

describe("route kernel ordering differential — one-rule pick vs retired pick", () => {
  it("orders every existing route fixture identically", () => {
    const views = fixtureViews();
    expect(views.map(orderedIds)).toEqual(views.map((v) => retiredOrder(v.clusters, v.origin)));
  });

  it("orders a seeded generated corpus of 1-50 cluster sets identically", () => {
    const views = corpusViews();
    expect(views.map(orderedIds)).toEqual(views.map((v) => retiredOrder(v.clusters, v.origin)));
  });
});
