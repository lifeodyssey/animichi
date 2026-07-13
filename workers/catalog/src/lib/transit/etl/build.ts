import { haversine } from "../../geo";
import { compareStrings } from "../compare";
import type { TopologyGraphAsset, TopologySource, TopologyStation } from "../model";
import type { EkidataGraph } from "./ekidata";
import type { N02Subgraph } from "./n02";

/** Maximum separation for equal-name cross-source transfer stitching. */
export const CROSS_SOURCE_TRANSFER_MAX_M = 400;

export interface SourceBuildStats { lines: number; stations: number; edges: number; transfer_groups: number }
export interface BuildStats {
  ekidata: SourceBuildStats;
  n02: SourceBuildStats;
  total: SourceBuildStats;
  isolated_stations: number;
  duplicate_warnings: number;
}

export interface BuildInputs {
  ekidata?: EkidataGraph;
  shinkansen?: N02Subgraph;
  generatedAt: string;
  retrievedAt?: { ekidata?: string; n02?: string };
}

export interface BuildResult { asset: TopologyGraphAsset; stats: BuildStats; warnings: string[] }
type Graph = EkidataGraph | N02Subgraph;

const emptyStats = (): SourceBuildStats => ({ lines: 0, stations: 0, edges: 0, transfer_groups: 0 });

function cleanedName(name: string): string {
  return name.replace(/\s/gu, "");
}

function groupCount(stations: readonly TopologyStation[]): number {
  const counts = new Map<string, number>();
  for (const station of stations) counts.set(station.group_id, (counts.get(station.group_id) ?? 0) + 1);
  return [...counts.values()].filter((count) => count > 1).length;
}

function sourceStats(graph?: Graph): SourceBuildStats {
  return graph ? { lines: graph.lines.length, stations: graph.stations.length, edges: graph.adjacency.length, transfer_groups: groupCount(graph.stations) } : emptyStats();
}

function groupsByName(stations: readonly TopologyStation[]): Map<string, Map<string, TopologyStation[]>> {
  const names = new Map<string, Map<string, TopologyStation[]>>();
  for (const station of stations) { const groups = names.get(cleanedName(station.name)) ?? new Map<string, TopologyStation[]>(); groups.set(station.group_id, [...(groups.get(station.group_id) ?? []), station]); names.set(cleanedName(station.name), groups); }
  return names;
}

function nearestGroup(station: TopologyStation, groups: ReadonlyMap<string, TopologyStation[]>): string | null {
  const candidates = [...groups].map(([groupId, members]) => ({ groupId, distance: Math.min(...members.map((member) => haversine(station.lat, station.lng, member.lat, member.lng))) }));
  candidates.sort((a, b) => a.distance - b.distance || compareStrings(a.groupId, b.groupId));
  const nearest = candidates[0];
  return nearest && nearest.distance <= CROSS_SOURCE_TRANSFER_MAX_M ? nearest.groupId : null;
}

function stitchStations(ekidata: readonly TopologyStation[], shinkansen: readonly TopologyStation[]): TopologyStation[] {
  const names = groupsByName(ekidata);
  return shinkansen.map((station) => { const group = nearestGroup(station, names.get(cleanedName(station.name)) ?? new Map()); return group ? { ...station, group_id: group } : station; });
}

function source(id: "ekidata" | "n02", retrievedAt?: string): TopologySource {
  if (id === "ekidata") return { id, name: "駅データ.jp", license: "ekidata.jp terms (commercial use and processing permitted; no attribution required; redistribution of unprocessed data restricted)", attribution_required: false, ...(retrievedAt ? { retrieved_at: retrievedAt } : {}) };
  return { id, name: "国土数値情報 鉄道データ N02 (国土交通省)", license: "CC BY 4.0", attribution_required: true, attribution_text: "出典:国土数値情報(鉄道データ)(国土交通省)(https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html)を加工して作成", ...(retrievedAt ? { retrieved_at: retrievedAt } : {}) };
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string, label: string, warnings: string[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => { const id = key(value); if (seen.has(id)) { warnings.push(`Duplicate ${label}: ${id}`); return false; } seen.add(id); return true; });
}

function isolatedCount(stations: readonly TopologyStation[], edges: TopologyGraphAsset["adjacency"]): number {
  const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  return stations.filter((station) => !connected.has(station.station_id)).length;
}

function totalStats(asset: TopologyGraphAsset): SourceBuildStats {
  return { lines: asset.lines.length, stations: asset.stations.length, edges: asset.adjacency.length, transfer_groups: groupCount(asset.stations) };
}

function missingWarnings(inputs: BuildInputs): string[] {
  const warnings: string[] = [];
  if (!inputs.ekidata) warnings.push("Built without ekidata input");
  if (!inputs.shinkansen) warnings.push("Built without N02 shinkansen input");
  return warnings;
}

export function buildTopologyAsset(inputs: BuildInputs): BuildResult {
  const warnings = missingWarnings(inputs);
  const ekidata = inputs.ekidata ?? { lines: [], stations: [], adjacency: [] };
  const shinkansen = inputs.shinkansen ?? { lines: [], stations: [], adjacency: [] };
  const stations = uniqueBy([...ekidata.stations, ...stitchStations(ekidata.stations, shinkansen.stations)], (item) => item.station_id, "station_id", warnings);
  const lines = uniqueBy([...ekidata.lines, ...shinkansen.lines], (item) => item.line_id, "line_id", warnings);
  const adjacency = uniqueBy([...ekidata.adjacency, ...shinkansen.adjacency], (item) => [item.from, item.to].sort(compareStrings).join("\u0000"), "adjacency", warnings);
  const sources = [inputs.ekidata ? source("ekidata", inputs.retrievedAt?.ekidata) : null, inputs.shinkansen ? source("n02", inputs.retrievedAt?.n02) : null].filter((item): item is TopologySource => item !== null);
  const asset: TopologyGraphAsset = { format_version: 1, generated_at: inputs.generatedAt, sources, lines, stations, adjacency };
  const stats = { ekidata: sourceStats(inputs.ekidata), n02: sourceStats(inputs.shinkansen), total: totalStats(asset), isolated_stations: isolatedCount(stations, adjacency), duplicate_warnings: warnings.filter((warning) => warning.startsWith("Duplicate ")).length };
  return { asset, stats, warnings };
}
