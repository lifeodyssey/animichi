import { describe, expect, it } from "vitest";
import { NEAREST_STATION_MAX_M } from "../src/lib/transit";
import { stationCoverage } from "../src/lib/transit/etl";
import type { TopologyStation } from "../src/lib/transit";

const station = (lat: number, lng: number): TopologyStation => ({ station_id: "s", line_id: "l", group_id: "g", name: "S", lat, lng });

describe("stationCoverage", () => {
  it("treats an empty spot set as fully covered", () => {
    expect(stationCoverage([], [])).toEqual({ covered: 0, total: 0, rate: 1 });
  });

  it("reports covered, total, and rate for a mixed set", () => {
    const result = stationCoverage([{ lat: 35, lng: 139 }, { lat: 36, lng: 140 }], [station(35, 139)]);
    expect(result).toEqual({ covered: 1, total: 2, rate: 0.5 });
  });

  it("includes a station exactly at the 3000 metre boundary", () => {
    const longitude = NEAREST_STATION_MAX_M / 6_371_000 * 180 / Math.PI;
    expect(stationCoverage([{ lat: 0, lng: 0 }], [station(0, longitude)])).toEqual({ covered: 1, total: 1, rate: 1 });
  });
});
