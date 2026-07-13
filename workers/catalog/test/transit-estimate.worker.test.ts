import { describe, expect, it } from "vitest";
import { buildTransitIndex, estimateTransitLeg, type TopologyGraphAsset } from "../src/lib/transit";
import { tokyoSample } from "./fixtures/transit/tokyo-sample";

const index = buildTransitIndex(tokyoSample);
const required = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("Expected test value");
  return value;
};
const coordinate = (stationId: string) => {
  const station = required(index.stations.get(stationId));
  return { lat: station.lat, lng: station.lng };
};

describe("estimateTransitLeg golden routes", () => {
  it("uses Chuo direct from Shinjuku to Kichijoji", () => {
    const estimate = required(estimateTransitLeg(coordinate("shinjuku-c"), coordinate("kichijoji-c"), index));
    expect(estimate.transfers).toBe(0);
    expect(estimate.line_names).toEqual(["中央線快速"]);
    expect(Math.abs(estimate.total_minutes - 15)).toBeLessThanOrEqual(10);
  });

  it("uses Inokashira direct from Shibuya to Kichijoji", () => {
    const estimate = required(estimateTransitLeg(coordinate("shibuya-i"), coordinate("kichijoji-i"), index));
    expect(estimate.transfers).toBe(0);
    expect(estimate.line_names).toEqual(["京王井の頭線"]);
    expect(Math.abs(estimate.total_minutes - 18)).toBeLessThanOrEqual(10);
  });

  it("uses exactly one transfer from Shinagawa to Kichijoji", () => {
    const estimate = required(estimateTransitLeg(coordinate("shinagawa"), coordinate("kichijoji-c"), index));
    // Deliberate near-tie optimality lock.
    expect(estimate.transfers).toBe(1);
    expect(estimate.total_minutes).toBe(45);
    expect(estimate.line_names).toEqual(["山手線", "京王井の頭線"]);
  });

  it("is deterministic", () => {
    const from = coordinate("shinagawa");
    const to = coordinate("kichijoji-c");
    expect(estimateTransitLeg(from, to, index)).toEqual(estimateTransitLeg(from, to, index));
  });
});

describe("estimateTransitLeg graceful degradation", () => {
  it("returns null outside coverage", () => {
    expect(estimateTransitLeg({ lat: 34.75, lng: 139.36 }, coordinate("shinjuku-c"), index)).toBeNull();
  });

  it("returns null for the same station group", () => {
    expect(estimateTransitLeg(coordinate("shinjuku-c"), coordinate("shinjuku-y"), index)).toBeNull();
  });

  it("returns null for disconnected groups", () => {
    const asset: TopologyGraphAsset = { format_version: 1, generated_at: "2026-07-13T00:00:00Z", sources: [], lines: [{ line_id: "a", name: "A", category: "tram" }, { line_id: "b", name: "B", category: "tram" }], stations: [{ station_id: "a1", line_id: "a", group_id: "a1", name: "A", lat: 35, lng: 139 }, { station_id: "b1", line_id: "b", group_id: "b1", name: "B", lat: 35.01, lng: 139.01 }], adjacency: [] };
    expect(estimateTransitLeg({ lat: 35, lng: 139 }, { lat: 35.01, lng: 139.01 }, buildTransitIndex(asset))).toBeNull();
  });
});
