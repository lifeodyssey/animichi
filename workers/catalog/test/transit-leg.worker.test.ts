import { describe, expect, it } from "vitest";
import type { LocationCluster } from "../src/lib/clustering";
import { buildTimedItinerary } from "../src/lib/route";
import { buildTransitIndex, maybeTransitLeg, type TopologyGraphAsset } from "../src/lib/transit";
import { tokyoSample } from "./fixtures/transit/tokyo-sample";

interface Point { id: string; latitude: number; longitude: number }

function cluster(id: string, lat: number, lng: number): LocationCluster<Point> {
  return { clusterId: id, centerLat: lat, centerLng: lng, photoCount: 1, points: [{ id, latitude: lat, longitude: lng }] };
}

function stationCoordinate(id: string): [number, number] {
  const station = tokyoSample.stations.find((item) => item.station_id === id);
  if (!station) throw new Error(`Missing fixture station ${id}`);
  return [station.lat, station.lng];
}

const shinjuku = stationCoordinate("shinjuku-c");
const kichijoji = stationCoordinate("kichijoji-c");
const tokyoIndex = buildTransitIndex(tokyoSample);
const directAsset: Omit<TopologyGraphAsset, "sources"> = {
  format_version: 1,
  generated_at: "2026-07-13T00:00:00Z",
  lines: [{ line_id: "fast", name: "高速線", category: "shinkansen" }],
  stations: [{ station_id: "f1", line_id: "fast", group_id: "fg1", name: "甲", lat: 35, lng: 139 }, { station_id: "f2", line_id: "fast", group_id: "fg2", name: "乙", lat: 35, lng: 139.1 }],
  adjacency: [{ from: "f1", to: "f2", distance_m: 10_000 }],
};
const directFrom = { id: "a", lat: 35, lng: 139 };
const directTo = { id: "b", lat: 35, lng: 139.1 };

describe("buildTimedItinerary transit injection", () => {
  it("uses transit for the Shinjuku to Kichijoji leg", () => {
    const itinerary = buildTimedItinerary([cluster("a", ...shinjuku), cluster("b", ...kichijoji)], { transit: tokyoIndex });
    expect(itinerary.legs[0]).toEqual(expect.objectContaining({ mode: "transit", duration_minutes: 21, board_station: "新宿", alight_station: "吉祥寺", summary: "新宿駅→吉祥寺駅:中央線快速,約21分・乗換0回" }));
    expect(Number.isInteger(itinerary.legs[0]?.duration_minutes)).toBe(true);
    expect(itinerary.total_minutes).toBe(37);
    expect(itinerary.total_distance_m).toBe(itinerary.legs[0]?.distance_m);
  });

  it("keeps an 800 metre pair byte-identical to walking", () => {
    const points = [cluster("a", 35.69, 139.70), cluster("b", 35.69, 139.7088)];
    expect(buildTimedItinerary(points, { transit: tokyoIndex })).toEqual(buildTimedItinerary(points));
  });

  it("falls back to walking outside station coverage", () => {
    const points = [cluster("a", 34.75, 139.36), cluster("b", 34.77, 139.36)];
    expect(buildTimedItinerary(points, { transit: tokyoIndex })).toEqual(buildTimedItinerary(points));
  });

  it("falls back when a rail detour is slower than walking", () => {
    const asset: TopologyGraphAsset = { format_version: 1, generated_at: "2026-07-13T00:00:00Z", sources: [], lines: [{ line_id: "slow", name: "遠回り線", category: "tram" }], stations: [{ station_id: "s1", line_id: "slow", group_id: "g1", name: "甲", lat: 35, lng: 139 }, { station_id: "s2", line_id: "slow", group_id: "g2", name: "乙", lat: 35, lng: 139.017 }], adjacency: [{ from: "s1", to: "s2", distance_m: 100_000 }] };
    const points = [cluster("a", 35, 139), cluster("b", 35, 139.017)];
    expect(buildTimedItinerary(points, { transit: buildTransitIndex(asset) })).toEqual(buildTimedItinerary(points));
  });

  it("falls back to buffered walking for a slow detour under packed pacing", () => {
    const asset: TopologyGraphAsset = { format_version: 1, generated_at: "2026-07-13T00:00:00Z", sources: [], lines: [{ line_id: "slow", name: "遠回り線", category: "tram" }], stations: [{ station_id: "s1", line_id: "slow", group_id: "g1", name: "甲", lat: 35, lng: 139 }, { station_id: "s2", line_id: "slow", group_id: "g2", name: "乙", lat: 35, lng: 139.017 }], adjacency: [{ from: "s1", to: "s2", distance_m: 100_000 }] };
    const points = [cluster("a", 35, 139), cluster("b", 35, 139.017)];
    expect(buildTimedItinerary(points, { pacing: "packed", transit: buildTransitIndex(asset) })).toEqual(buildTimedItinerary(points, { pacing: "packed" }));
  });

  it("carries required source attribution on transit legs", () => {
    const source = { id: "n02", name: "N02", license: "CC BY 4.0", attribution_required: true, attribution_text: "N02 attribution" };
    const leg = maybeTransitLeg(directFrom, directTo, buildTransitIndex({ ...directAsset, sources: [source] }));
    expect(leg?.attribution).toEqual(["N02 attribution"]);
  });

  it("omits attribution for an index without required sources", () => {
    const leg = maybeTransitLeg(directFrom, directTo, buildTransitIndex({ ...directAsset, sources: [] }));
    expect(leg).not.toBeNull();
    expect("attribution" in (leg ?? {})).toBe(false);
  });

  it("keeps no-index output byte-identical on a transit-eligible pair", () => {
    const points = [cluster("a", ...shinjuku), cluster("b", ...kichijoji)];
    expect(buildTimedItinerary(points)).toEqual(buildTimedItinerary(points, { transit: undefined }));
  });

  it("aggregates a mixed walk and transit itinerary", () => {
    const points = [cluster("a", ...shinjuku), cluster("b", 35.6909, 139.7091), cluster("c", ...kichijoji)];
    const itinerary = buildTimedItinerary(points, { transit: tokyoIndex });
    expect(itinerary.legs.map((leg) => leg.mode)).toEqual(["walk", "transit"]);
    expect(itinerary.total_minutes).toBe(itinerary.stops.reduce((sum, stop) => sum + stop.dwell_minutes, 0) + itinerary.legs.reduce((sum, leg) => sum + leg.duration_minutes, 0));
    expect(itinerary.total_distance_m).toBeCloseTo(itinerary.legs.reduce((sum, leg) => sum + leg.distance_m, 0), 1);
  });
});
