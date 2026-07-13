import { describe, expect, it } from "vitest";
import { buildTransitIndex, estimateTransitLeg, parseTopologyGraph } from "../src/lib/transit";
import { buildTopologyAsset, type EkidataGraph, type N02Subgraph } from "../src/lib/transit/etl";

const ekidata: EkidataGraph = {
  lines: [{ line_id: "local", name: "在来線", category: "jr_conventional" }],
  stations: [
    { station_id: "local-transfer", line_id: "local", group_id: "shared", name: "接続 駅", lat: 35, lng: 139 },
    { station_id: "local-end", line_id: "local", group_id: "local-end", name: "在来終点", lat: 35, lng: 139.01 },
  ],
  adjacency: [{ from: "local-transfer", to: "local-end", distance_m: 1000 }],
};
const shinkansen: N02Subgraph = {
  lines: [{ line_id: "n02:test", name: "テスト新幹線", category: "shinkansen" }],
  stations: [
    { station_id: "n02:start", line_id: "n02:test", group_id: "n02g:start", name: "新幹始発", lat: 35, lng: 138.99 },
    { station_id: "n02:transfer", line_id: "n02:test", group_id: "n02g:transfer", name: "接続駅", lat: 35.0001, lng: 139.0001 },
  ],
  adjacency: [{ from: "n02:start", to: "n02:transfer", distance_m: 1000 }],
};
const inputs = { ekidata, shinkansen, generatedAt: "2026-07-13T00:00:00.000Z", retrievedAt: { n02: "2026-07-12" } };

describe("buildTopologyAsset", () => {
  it("rewrites a nearby equal-name shinkansen transfer group", () => {
    const station = buildTopologyAsset(inputs).asset.stations.find((item) => item.station_id === "n02:transfer");
    expect(station?.group_id).toBe("shared");
  });

  it("round-trips and carries required N02 attribution", () => {
    const asset = buildTopologyAsset(inputs).asset;
    expect(parseTopologyGraph(JSON.parse(JSON.stringify(asset)))).toEqual(asset);
    expect(asset.sources[1]).toEqual({ id: "n02", name: "国土数値情報 鉄道データ N02 (国土交通省)", license: "CC BY 4.0", attribution_required: true, attribution_text: "出典:国土数値情報(鉄道データ)(国土交通省)(https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html)を加工して作成", retrieved_at: "2026-07-12" });
  });

  it("makes a stitched shinkansen-to-conventional estimate reachable", () => {
    const index = buildTransitIndex(buildTopologyAsset(inputs).asset);
    const estimate = estimateTransitLeg({ lat: 35, lng: 138.99 }, { lat: 35, lng: 139.01 }, index);
    expect(estimate?.line_names).toEqual(["テスト新幹線", "在来線"]);
    expect(estimate?.transfers).toBe(1);
  });

  it("reports per-source, total, isolated, and duplicate statistics", () => {
    const result = buildTopologyAsset(inputs);
    expect(result.stats).toEqual({ ekidata: { lines: 1, stations: 2, edges: 1, transfer_groups: 0 }, n02: { lines: 1, stations: 2, edges: 1, transfer_groups: 0 }, total: { lines: 2, stations: 4, edges: 2, transfer_groups: 1 }, isolated_stations: 0, duplicate_warnings: 0 });
  });

  it("runs with one source and reports the absent source", () => {
    const result = buildTopologyAsset({ ekidata, generatedAt: "2026-07-13T00:00:00.000Z" });
    expect(result.asset.sources.map((item) => item.id)).toEqual(["ekidata"]);
    expect(result.warnings).toContain("Built without N02 shinkansen input");
  });
});
