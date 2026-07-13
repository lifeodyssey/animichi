import { describe, expect, it } from "vitest";
import { haversine } from "../src/lib/geo";
import { buildTransitIndex, shortestPath } from "../src/lib/transit";
import { buildShinkansenSubgraph, N02_SNAP_DECIMALS } from "../src/lib/transit/etl";

const properties = { N02_001: "11", N02_002: "1", N02_003: "テスト新幹線", N02_004: "テストJR" };
const feature = (coordinates: number[][], extra: Record<string, string> = {}) => ({ type: "Feature", properties: { ...properties, ...extra }, geometry: { type: "LineString", coordinates } });
const collection = (features: object[]) => ({ type: "FeatureCollection", features });
const station = (name: string, code: string, group: string, left: number, right: number) => feature([[left, 35], [right, 35]], { N02_005: name, N02_005c: code, N02_005g: group });

const sections = collection([
  feature([[139.00011, 35], [139.01001, 35]]),
  feature([[139.01011, 35], [139.01501, 35]]),
  feature([[139.01504, 35], [139.02001, 35]]),
  feature([[139.01012, 35], [139.01012, 35.005]]),
  { type: "Feature", properties: { N02_001: "11", N02_003: "欠損新幹線" }, geometry: { type: "LineString", coordinates: [[140, 35], [140.1, 35]] } },
]);
const stations = collection([
  station("甲", "a", "ga", 139.00000, 139.00014),
  station("乙", "b", "gb", 139.01004, 139.01014),
  station("丙", "c", "gc", 139.02004, 139.02014),
]);

describe("buildShinkansenSubgraph", () => {
  it("snaps endpoints and walks to exactly adjacent stations", () => {
    const result = buildShinkansenSubgraph(sections, stations);
    expect(N02_SNAP_DECIMALS).toBe(4);
    expect(result.graph.stations.map((item) => item.station_id)).toEqual(["n02:a", "n02:b", "n02:c"]);
    expect(result.graph.stations[0]).toEqual(expect.objectContaining({ lng: 139.00007, lat: 35 }));
    expect(result.graph.adjacency.map((edge) => [edge.from, edge.to])).toEqual([["n02:a", "n02:b"], ["n02:b", "n02:c"]]);
  });

  it("uses true unsnapped section lengths", () => {
    const result = buildShinkansenSubgraph(sections, stations);
    const first = Math.round(haversine(35, 139.00011, 35, 139.01001));
    const second = Math.round(haversine(35, 139.01011, 35, 139.01501) + haversine(35, 139.01504, 35, 139.02001));
    expect(result.graph.adjacency.map((edge) => edge.distance_m)).toEqual([first, second]);
  });

  it("collects warnings for shinkansen features missing properties", () => {
    expect(buildShinkansenSubgraph(sections, stations).warnings).toContain("sections[4]: missing required properties");
  });

  it("excludes conventional JR features even when rail type is 11", () => {
    const conventional = collection([feature([[139, 35], [139.1, 35]], { N02_003: "指宿枕崎線" })]);
    const result = buildShinkansenSubgraph(conventional, collection([]));
    expect(result.graph.lines).toEqual([]);
    expect(result.graph.adjacency).toEqual([]);
  });

  it("keeps one continuous line across an operator handover", () => {
    const east = { N02_004: "JR東日本" };
    const west = { N02_004: "JR西日本" };
    const splitSections = collection([feature([[139.0001, 35], [139.0100, 35]], east), feature([[139.0101, 35], [139.0200, 35]], west)]);
    const splitStations = collection([feature([[139, 35], [139.0001, 35]], { ...east, N02_005: "甲", N02_005c: "x" }), feature([[139.0100, 35], [139.0101, 35]], { ...east, N02_005: "乙", N02_005c: "y" }), feature([[139.0200, 35], [139.0201, 35]], { ...west, N02_005: "丙", N02_005c: "z" })]);
    const result = buildShinkansenSubgraph(splitSections, splitStations);
    expect(result.graph.lines).toEqual([{ line_id: "n02:テスト新幹線", name: "テスト新幹線", category: "shinkansen" }]);
    expect(result.graph.stations.map((item) => item.line_id)).toEqual(["n02:テスト新幹線", "n02:テスト新幹線", "n02:テスト新幹線"]);
    expect(result.graph.adjacency).toHaveLength(2);
    const index = buildTransitIndex({ format_version: 1, generated_at: "2026-07-13T00:00:00Z", sources: [], ...result.graph });
    expect(shortestPath(index, "n02:x", "n02:z")?.transfers).toBe(0);
  });

  it("accepts edition-specific property key mappings", () => {
    const custom = collection([{ type: "Feature", properties: { kind: "11", operatorKind: "1", line: "L新幹線", operator: "O", stop: "S" }, geometry: { type: "LineString", coordinates: [[139, 35], [139.001, 35]] } }]);
    const result = buildShinkansenSubgraph(collection([]), custom, { props: { railType: "kind", operatorType: "operatorKind", lineName: "line", operatorName: "operator", stationName: "stop" } });
    expect(result.graph.stations).toHaveLength(1);
  });
});
