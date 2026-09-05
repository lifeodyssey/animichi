import { CATEGORY_SPEED_KMH, EXPECTED_WAIT_MIN, TRANSFER_PENALTY_MIN } from "./constants";
import { compareStrings } from "./compare";
import type { TopologyGraphAsset, TopologyLine, TopologySource, TopologyStation } from "./model";

export interface TransitEdge {
  to: string;
  kind: "rail" | "transfer";
  minutes: number;
  distance_m: number;
  line_id?: string;
}

export interface TransitIndex {
  adjacency: ReadonlyMap<string, readonly TransitEdge[]>;
  stations: ReadonlyMap<string, TopologyStation>;
  lines: ReadonlyMap<string, TopologyLine>;
  groups: ReadonlyMap<string, readonly string[]>;
  sources: readonly TopologySource[];
}

function railMinutes(distanceM: number, line: TopologyLine): number {
  return distanceM / (CATEGORY_SPEED_KMH[line.category] * 1000 / 60);
}

function addEdge(graph: Map<string, TransitEdge[]>, from: string, edge: TransitEdge): void {
  const edges = graph.get(from) ?? [];
  edges.push(edge);
  graph.set(from, edges);
}

function addRailEdge(graph: Map<string, TransitEdge[]>, from: string, to: string, distanceM: number, line: TopologyLine): void {
  addEdge(graph, from, { to, kind: "rail", minutes: railMinutes(distanceM, line), distance_m: distanceM, line_id: line.line_id });
}

function railStations(edge: TopologyGraphAsset["adjacency"][number], stations: ReadonlyMap<string, TopologyStation>): [TopologyStation, TopologyStation] {
  const from = stations.get(edge.from);
  const to = stations.get(edge.to);
  if (!from || !to) throw new Error(`Invalid topology graph reference: ${edge.from}→${edge.to}`);
  if (from.line_id !== to.line_id) throw new Error(`Cross-line rail edge ${edge.from}→${edge.to}`);
  return [from, to];
}

function addRailPair(graph: Map<string, TransitEdge[]>, edge: TopologyGraphAsset["adjacency"][number], stations: Map<string, TopologyStation>, lines: Map<string, TopologyLine>): void {
  const [station] = railStations(edge, stations);
  const line = lines.get(station.line_id);
  if (!line) throw new Error(`Invalid topology graph reference: ${edge.from}→${edge.to}`);
  addRailEdge(graph, edge.from, edge.to, edge.distance_m, line);
  addRailEdge(graph, edge.to, edge.from, edge.distance_m, line);
}

function addTransfer(graph: Map<string, TransitEdge[]>, from: string, to: string): void {
  addEdge(graph, from, { to, kind: "transfer", minutes: TRANSFER_PENALTY_MIN + EXPECTED_WAIT_MIN, distance_m: 0 });
}

function addTransfersFrom(graph: Map<string, TransitEdge[]>, ids: readonly string[], left: number): void {
  for (let right = left + 1; right < ids.length; right += 1) {
    const from = ids.at(left);
    const to = ids.at(right);
    if (!from || !to) continue;
    addTransfer(graph, from, to);
    addTransfer(graph, to, from);
  }
}

function addTransferPairs(graph: Map<string, TransitEdge[]>, ids: readonly string[]): void {
  for (let left = 0; left < ids.length; left += 1) addTransfersFrom(graph, ids, left);
}

function groupStations(stations: readonly TopologyStation[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const station of stations) groups.set(station.group_id, [...(groups.get(station.group_id) ?? []), station.station_id]);
  for (const ids of groups.values()) ids.sort(compareStrings);
  return groups;
}

function sortEdges(graph: Map<string, TransitEdge[]>): void {
  for (const edges of graph.values()) edges.sort((a, b) => compareStrings(a.to, b.to) || compareStrings(a.kind, b.kind));
}

export function buildTransitIndex(asset: TopologyGraphAsset): TransitIndex {
  const stations = new Map(asset.stations.map((station) => [station.station_id, station]));
  const lines = new Map(asset.lines.map((line) => [line.line_id, line]));
  const adjacency = new Map(asset.stations.map((station) => [station.station_id, [] as TransitEdge[]]));
  const groups = groupStations(asset.stations);
  for (const edge of asset.adjacency) addRailPair(adjacency, edge, stations, lines);
  for (const ids of groups.values()) addTransferPairs(adjacency, ids);
  sortEdges(adjacency);
  return { adjacency, stations, lines, groups, sources: asset.sources };
}
