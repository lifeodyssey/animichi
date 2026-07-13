import { haversine } from "../../geo";
import { compareStrings } from "../compare";
import { MinHeap } from "../heap";
import type { AdjacencyEdge, TopologyLine, TopologyStation } from "../model";

/** Decimal places used to snap nearby N02 segment endpoints into one vertex. */
export const N02_SNAP_DECIMALS = 4;

export interface N02Subgraph {
  lines: TopologyLine[];
  stations: TopologyStation[];
  adjacency: AdjacencyEdge[];
}

export interface N02PropertyNames {
  railType: string;
  operatorType: string;
  lineName: string;
  operatorName: string;
  stationName: string;
  stationCode: string;
  groupCode: string;
}

export interface N02Options { props?: Partial<N02PropertyNames> }
export interface N02Result { graph: N02Subgraph; warnings: string[] }

type RecordValue = Record<string, unknown>;
type CoordinatePair = readonly [number, number];
type Polyline = CoordinatePair[];
interface ParsedFeature { properties: RecordValue; coordinates: Polyline; index: number }
interface SegmentEdge { to: string; distance: number }
interface ParsedStation { station: TopologyStation; vertices: string[]; lineName: string }
interface WalkItem { vertex: string; distance: number }

const defaultPropertyNames: N02PropertyNames = { railType: "N02_001", operatorType: "N02_002", lineName: "N02_003", operatorName: "N02_004", stationName: "N02_005", stationCode: "N02_005c", groupCode: "N02_005g" };

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function pair(value: unknown): CoordinatePair | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  return typeof value[0] === "number" && typeof value[1] === "number" ? [value[0], value[1]] : null;
}

function polyline(value: unknown): Polyline | null {
  if (!Array.isArray(value)) return null;
  const pairs = value.map(pair);
  return pairs.length >= 2 && pairs.every((item) => item !== null) ? pairs : null;
}

function features(input: unknown, label: string, warnings: string[]): ParsedFeature[] {
  const collection = record(input);
  const values = collection && Array.isArray(collection.features) ? collection.features : [];
  if (!collection || !Array.isArray(collection.features)) warnings.push(`${label}: expected a GeoJSON FeatureCollection`);
  return values.map((value, index) => parseFeature(value, index, label, warnings)).filter((item): item is ParsedFeature => item !== null);
}

function parseFeature(value: unknown, index: number, label: string, warnings: string[]): ParsedFeature | null {
  const feature = record(value);
  const geometry = record(feature?.geometry);
  const properties = record(feature?.properties);
  const coordinates = polyline(geometry?.coordinates);
  if (properties && geometry?.type === "LineString" && coordinates) return { properties, coordinates, index };
  warnings.push(`${label}[${String(index)}]: missing properties or LineString geometry`);
  return null;
}

function text(properties: RecordValue, key: string): string | null {
  const value = properties[key];
  return typeof value === "string" && value.length ? value : null;
}

function lineNameOf(feature: ParsedFeature, props: N02PropertyNames): string | null {
  return text(feature.properties, props.lineName);
}

function isShinkansen(feature: ParsedFeature, props: N02PropertyNames): boolean {
  return text(feature.properties, props.lineName)?.includes("新幹線") ?? false;
}

function slug(value: string): string {
  const result = value.normalize("NFKC").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/gu, "");
  return result || "unknown";
}

function topologyLine(key: string): TopologyLine {
  return { line_id: `n02:${slug(key)}`, name: key, category: "shinkansen" };
}

function snap(pair_: CoordinatePair): string {
  return `${pair_[1].toFixed(N02_SNAP_DECIMALS)},${pair_[0].toFixed(N02_SNAP_DECIMALS)}`;
}

function length(coordinates: readonly CoordinatePair[]): number {
  return coordinates.slice(1).reduce((sum, point, index) => sum + haversine(coordinates[index]?.[1] ?? point[1], coordinates[index]?.[0] ?? point[0], point[1], point[0]), 0);
}

function endpoints(coordinates: Polyline): [string, string] {
  return [snap(coordinates[0] ?? [0, 0]), snap(coordinates.at(-1) ?? [0, 0])];
}

function addSegment(graph: Map<string, SegmentEdge[]>, coordinates: Polyline): void {
  const [from, to] = endpoints(coordinates);
  const distance = length(coordinates);
  graph.set(from, [...(graph.get(from) ?? []), { to, distance }]);
  graph.set(to, [...(graph.get(to) ?? []), { to: from, distance }]);
}

function buildSegmentGraph(features_: readonly ParsedFeature[]): Map<string, SegmentEdge[]> {
  const graph = new Map<string, SegmentEdge[]>();
  for (const feature of features_) addSegment(graph, feature.coordinates);
  return graph;
}

function midpoint(coordinates: Polyline): CoordinatePair {
  const first = coordinates[0] ?? [0, 0];
  const last = coordinates.at(-1) ?? first;
  return [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
}

function stationId(feature: ParsedFeature, line: TopologyLine, props: N02PropertyNames, name: string): string {
  const code = text(feature.properties, props.stationCode);
  return code ? `n02:${code}` : `n02:${line.line_id}:${slug(name)}`;
}

function stationGroup(feature: ParsedFeature, line: TopologyLine, props: N02PropertyNames, name: string): string {
  const code = text(feature.properties, props.groupCode);
  return code ? `n02g:${code}` : `n02g:${line.line_id}:${slug(name)}`;
}

function parseStation(feature: ParsedFeature, lines: ReadonlyMap<string, TopologyLine>, props: N02PropertyNames, warnings: string[]): ParsedStation | null {
  const lineName = lineNameOf(feature, props);
  const name = text(feature.properties, props.stationName);
  const line = lineName ? lines.get(lineName) : undefined;
  if (!lineName || !name || !line) { warnings.push(`stations[${String(feature.index)}]: missing required shinkansen properties`); return null; }
  const center = midpoint(feature.coordinates);
  return { station: { station_id: stationId(feature, line, props, name), group_id: stationGroup(feature, line, props, name), line_id: line.line_id, name, lng: center[0], lat: center[1] }, vertices: endpoints(feature.coordinates), lineName };
}

function targetStations(stations: readonly ParsedStation[]): Map<string, string[]> {
  const targets = new Map<string, string[]>();
  for (const item of stations) for (const vertex of item.vertices) targets.set(vertex, [...(targets.get(vertex) ?? []), item.station.station_id]);
  return targets;
}

function seedWalk(source: ParsedStation, heap: MinHeap<WalkItem>, distances: Map<string, number>): void {
  for (const vertex of source.vertices) { distances.set(vertex, 0); heap.push({ vertex, distance: 0 }, 0, vertex); }
}

function relaxWalk(edge: SegmentEdge, distance: number, heap: MinHeap<WalkItem>, distances: Map<string, number>): void {
  const candidate = distance + edge.distance;
  if (candidate >= (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) return;
  distances.set(edge.to, candidate);
  heap.push({ vertex: edge.to, distance: candidate }, candidate, edge.to);
}

function reachedTarget(item: WalkItem, sourceId: string, targets: ReadonlyMap<string, string[]>): string | null {
  return (targets.get(item.vertex) ?? []).filter((id) => id !== sourceId).sort(compareStrings)[0] ?? null;
}

function visitWalk(item: WalkItem, sourceId: string, graph: ReadonlyMap<string, SegmentEdge[]>, targets: ReadonlyMap<string, string[]>, found: Map<string, number>, heap: MinHeap<WalkItem>, distances: Map<string, number>): void {
  const target = reachedTarget(item, sourceId, targets);
  if (target) { if (!found.has(target)) found.set(target, item.distance); return; }
  for (const edge of graph.get(item.vertex) ?? []) relaxWalk(edge, item.distance, heap, distances);
}

function walkToNeighbors(source: ParsedStation, graph: ReadonlyMap<string, SegmentEdge[]>, targets: ReadonlyMap<string, string[]>): Map<string, number> {
  const heap = new MinHeap<WalkItem>();
  const distances = new Map<string, number>();
  const found = new Map<string, number>();
  seedWalk(source, heap, distances);
  while (heap.size) { const item = heap.pop(); if (!item || item.distance !== distances.get(item.vertex)) continue; visitWalk(item, source.station.station_id, graph, targets, found, heap, distances); }
  return found;
}

function edgeKey(from: string, to: string): string {
  return [from, to].sort(compareStrings).join("\u0000");
}

function adjacencyFor(stations: readonly ParsedStation[], graph: ReadonlyMap<string, SegmentEdge[]>): AdjacencyEdge[] {
  const targets = targetStations(stations);
  const edges = new Map<string, AdjacencyEdge>();
  for (const source of stations) for (const [to, distance] of walkToNeighbors(source, graph, targets)) addAdjacency(edges, source.station.station_id, to, distance);
  return [...edges.values()].sort((a, b) => compareStrings(edgeKey(a.from, a.to), edgeKey(b.from, b.to)));
}

function addAdjacency(edges: Map<string, AdjacencyEdge>, from: string, to: string, distance: number): void {
  const key = edgeKey(from, to);
  if (!edges.has(key)) edges.set(key, { from, to, distance_m: Math.round(distance) });
}

function resolvePropertyNames(options?: N02Options): N02PropertyNames {
  return { ...defaultPropertyNames, ...options?.props };
}

function requiredProps(feature: ParsedFeature, props: N02PropertyNames, station: boolean): boolean {
  const values = [text(feature.properties, props.operatorType), text(feature.properties, props.lineName), text(feature.properties, props.operatorName)];
  if (station) values.push(text(feature.properties, props.stationName));
  return values.every((value) => value !== null);
}

function relevant(features_: readonly ParsedFeature[], props: N02PropertyNames, label: string, station: boolean, warnings: string[]): ParsedFeature[] {
  const missingType = features_.filter((feature) => text(feature.properties, props.railType) === null);
  const shinkansen = features_.filter((feature) => isShinkansen(feature, props));
  const malformed = shinkansen.filter((feature) => !requiredProps(feature, props, station));
  warnings.push(...[...missingType, ...malformed].map((feature) => `${label}[${String(feature.index)}]: missing required properties`));
  return shinkansen.filter((feature) => requiredProps(feature, props, station));
}

export function buildShinkansenSubgraph(sections: unknown, stations: unknown, options?: N02Options): N02Result {
  const warnings: string[] = [];
  const props = resolvePropertyNames(options);
  const sectionFeatures = relevant(features(sections, "sections", warnings), props, "sections", false, warnings);
  const stationFeatures = relevant(features(stations, "stations", warnings), props, "stations", true, warnings);
  const lineNames = [...new Set([...sectionFeatures, ...stationFeatures].map((item) => lineNameOf(item, props)).filter((name): name is string => name !== null))].sort(compareStrings);
  const lines = new Map(lineNames.map((name) => [name, topologyLine(name)]));
  const parsedStations = stationFeatures.map((item) => parseStation(item, lines, props, warnings)).filter((item): item is ParsedStation => item !== null);
  const byLine = new Map(lineNames.map((name) => [name, parsedStations.filter((item) => item.lineName === name)]));
  const adjacency = lineNames.flatMap((name) => adjacencyFor(byLine.get(name) ?? [], buildSegmentGraph([...sectionFeatures.filter((item) => lineNameOf(item, props) === name), ...stationFeatures.filter((item) => lineNameOf(item, props) === name)])));
  return { graph: { lines: [...lines.values()], stations: parsedStations.map((item) => item.station), adjacency }, warnings };
}
