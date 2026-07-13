import { describe, expect, it } from "vitest";
import { haversine } from "../src/lib/geo";
import { buildTransitIndex, parseTopologyGraph } from "../src/lib/transit";
import { tokyoSample } from "./fixtures/transit/tokyo-sample";

const required = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("Expected fixture value");
  return value;
};

describe("Tokyo transit fixture", () => {
  it("keeps literal rail distances close to curved haversine distances", () => {
    const stations = new Map(tokyoSample.stations.map((station) => [station.station_id, station]));
    const ratios = tokyoSample.adjacency.map((edge) => {
      const from = required(stations.get(edge.from));
      const to = required(stations.get(edge.to));
      return edge.distance_m / (haversine(from.lat, from.lng, to.lat, to.lng) * 1.15);
    });
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(0.8);
    expect(Math.max(...ratios)).toBeLessThanOrEqual(1.2);
  });

  it("places Shinjuku and Kichijoji 11–14 km apart", () => {
    const shinjuku = required(tokyoSample.stations.find((station) => station.station_id === "shinjuku-c"));
    const kichijoji = required(tokyoSample.stations.find((station) => station.station_id === "kichijoji-c"));
    expect(haversine(shinjuku.lat, shinjuku.lng, kichijoji.lat, kichijoji.lng)).toBeGreaterThan(10_500);
    expect(haversine(shinjuku.lat, shinjuku.lng, kichijoji.lat, kichijoji.lng)).toBeLessThan(14_000);
  });

  it("derives bidirectional transfers for shared groups", () => {
    const index = buildTransitIndex(tokyoSample);
    expect(index.adjacency.get("shinjuku-c")).toContainEqual(expect.objectContaining({ to: "shinjuku-y", kind: "transfer" }));
    expect(index.adjacency.get("shinjuku-y")).toContainEqual(expect.objectContaining({ to: "shinjuku-c", kind: "transfer" }));
  });
});

describe("parseTopologyGraph", () => {
  it("accepts a valid JSON round trip", () => {
    expect(parseTopologyGraph(JSON.parse(JSON.stringify(tokyoSample)))).toEqual(tokyoSample);
  });

  it("rejects a missing field with its path", () => {
    expect(() => parseTopologyGraph({ format_version: 1 })).toThrow("generated_at must be a string");
  });

  it("rejects a wrong nested type with its path", () => {
    const malformed = { ...tokyoSample, stations: [{ ...tokyoSample.stations[0], lat: "north" }] };
    expect(() => parseTopologyGraph(malformed)).toThrow("stations[0].lat must be a finite number");
  });

  it("rejects a malformed generation timestamp", () => {
    expect(() => parseTopologyGraph({ ...tokyoSample, generated_at: "yesterday" })).toThrow("generated_at must be an ISO timestamp");
  });

  it("rejects a negative adjacency distance", () => {
    const malformed = { ...tokyoSample, adjacency: [{ ...tokyoSample.adjacency[0], distance_m: -1 }] };
    expect(() => parseTopologyGraph(malformed)).toThrow("adjacency[0].distance_m must be a non-negative number");
  });

  it("rejects a cross-line rail edge", () => {
    const malformed = { ...tokyoSample, adjacency: [{ from: "shinagawa", to: "shibuya-i", distance_m: 1 }] };
    expect(() => buildTransitIndex(malformed)).toThrow("Cross-line rail edge shinagawa→shibuya-i");
  });
});
