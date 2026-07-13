import { describe, expect, it, vi } from "vitest";
import { buildGazetteer, renderAudit, renderSql, type Prefecture } from "../scripts/build-gazetteer";

const STATIONS = {
  type: "FeatureCollection",
  features: [
    { geometry: { type: "LineString", coordinates: [[135, 35], [135.0002, 35.0002]] }, properties: { N02_005: "試験" } },
    { geometry: { type: "LineString", coordinates: [[135.0001, 35.0001], [135.0003, 35.0003]] }, properties: { N02_005: "試験" } },
    { geometry: { type: "LineString", coordinates: [[136, 36], [136.0002, 36.0002]] }, properties: { N02_005: "試験" } },
  ],
};

const CITIES = [
  ["1", "Sendai", "Sendai", "せんだい", "31.82", "130.30", "", "PPLA", "JP", "", "18"].join("\t"),
  ["2", "Sendai", "Sendai", "センダイ", "38.2688", "140.8721", "", "PPL", "JP", "", "24"].join("\t"),
  ["3", "Sendai", "Sendai", "せんだい", "38.275", "140.88", "", "PPLA", "JP", "", "24"].join("\t"),
  ["4", "O'City", "O'City", "オ市", "34.5", "135.5", "", "PPLX", "JP", "", "32"].join("\t"),
].join("\n");

const PREFECTURE: Prefecture = {
  jis: "04", name: "宮城県", en: "Miyagi", capital: "仙台市", lat: 38.2688, lng: 140.8721, admin1: "24",
};

const CITY_NAMES = {
  Sendai: { ja: "仙台", zh: "仙台" },
  "O'City": { ja: "オ", zh: "欧城" },
};

function build(stations: typeof STATIONS = STATIONS) {
  return buildGazetteer({ stations, cities: CITIES, cityNames: CITY_NAMES, prefectures: [PREFECTURE] });
}

const META = { stationSha: "station-sha", citiesSha: "cities-sha", command: "generator command" };

describe("gazetteer generator", () => {
  it("clusters same-name station platforms within 500m and retains a distant complex", () => {
    const stations = build().locations.filter((row) => row.kind === "station");
    expect(stations).toHaveLength(2);
    expect(stations.map((row) => [row.name, row.pref])).toEqual([["試験", null], ["試験", null]]);
  });

  it("assigns city, ward, and prefecture kinds with the specified alias rules", () => {
    const result = build();
    expect(result.locations.map((row) => row.kind).sort()).toEqual(["city", "city", "city", "prefecture", "station", "station", "ward"]);
    expect(result.aliases).toEqual(expect.arrayContaining([
      expect.objectContaining({ alias: "試験駅", lang: "ja", priority: 0 }),
      expect.objectContaining({ alias: "欧城", lang: "zh", priority: 5 }),
      expect.objectContaining({ alias: "宮城県", locationId: "pref:04", priority: 20 }),
      expect.objectContaining({ alias: "仙台", locationId: "geonames:3", priority: 10 }),
      expect.objectContaining({ alias: "仙台市", lang: "ja", locationId: "geonames:3", priority: 10 }),
    ]));
  });

  it("warns and skips capital aliases when no GeoNames city is within 15km", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const remote = { ...PREFECTURE, jis: "47", name: "沖縄県", capital: "那覇市", lat: 26.2124, lng: 127.6809 };
    const result = buildGazetteer({ stations: STATIONS, cities: CITIES, cityNames: CITY_NAMES, prefectures: [remote] });
    expect(warn).toHaveBeenCalledWith("capital city not found within 15km: 沖縄県 (那覇市)");
    expect(result.aliases.some((row) => row.alias === "那覇" || row.alias === "那覇市")).toBe(false);
    warn.mockRestore();
  });

  it("renders stable ordering and SQL-safe apostrophes", () => {
    const reversed = { ...STATIONS, features: [...STATIONS.features].reverse() };
    expect(renderSql(build(reversed), META)).toBe(renderSql(build(), META));
    expect(renderSql(build(), META)).toContain("'O''City'");
    expect(renderAudit(build()).split("\n").at(-2)).toBe("SUMMARY,station=2;city=3;ward=1;prefecture=1");
  });
});
