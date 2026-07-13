export type RailCategory =
  | "shinkansen"
  | "jr_conventional"
  | "private_rail"
  | "subway"
  | "tram";

export interface TopologySource {
  id: string;
  name: string;
  license: string;
  attribution_required: boolean;
  attribution_text?: string;
  retrieved_at?: string;
}

export interface TopologyLine {
  line_id: string;
  name: string;
  category: RailCategory;
}

export interface TopologyStation {
  station_id: string;
  line_id: string;
  group_id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface AdjacencyEdge {
  from: string;
  to: string;
  distance_m: number;
}

export interface TopologyGraphAsset {
  format_version: 1;
  generated_at: string;
  sources: TopologySource[];
  lines: TopologyLine[];
  stations: TopologyStation[];
  adjacency: AdjacencyEdge[];
}

type UnknownRecord = Record<string, unknown>;

const categories = new Set<RailCategory>([
  "shinkansen", "jr_conventional", "private_rail", "subway", "tram",
]);

function fail(path: string, expected: string): never {
  throw new Error(`Invalid topology graph: ${path} must be ${expected}`);
}

function record(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "an object");
  return value as UnknownRecord;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "a string");
  return value;
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "a finite number");
  return value;
}

function nonNegativeNumberAt(value: unknown, path: string): number {
  const number = numberAt(value, path);
  if (number < 0) fail(path, "a non-negative number");
  return number;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "a boolean");
  return value;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "an array");
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : stringAt(value, path);
}

function isoStringAt(value: unknown, path: string): string {
  const text = stringAt(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || Number.isNaN(Date.parse(text))) fail(path, "an ISO timestamp");
  return text;
}

function parseSource(value: unknown, index: number): TopologySource {
  const path = `sources[${String(index)}]`;
  const item = record(value, path);
  return { id: stringAt(item.id, `${path}.id`), name: stringAt(item.name, `${path}.name`), license: stringAt(item.license, `${path}.license`), attribution_required: booleanAt(item.attribution_required, `${path}.attribution_required`), attribution_text: optionalString(item.attribution_text, `${path}.attribution_text`), retrieved_at: optionalString(item.retrieved_at, `${path}.retrieved_at`) };
}

function categoryAt(value: unknown, path: string): RailCategory {
  if (typeof value !== "string" || !categories.has(value as RailCategory)) fail(path, "a valid rail category");
  return value as RailCategory;
}

function parseLine(value: unknown, index: number): TopologyLine {
  const path = `lines[${String(index)}]`;
  const item = record(value, path);
  return { line_id: stringAt(item.line_id, `${path}.line_id`), name: stringAt(item.name, `${path}.name`), category: categoryAt(item.category, `${path}.category`) };
}

function parseStation(value: unknown, index: number): TopologyStation {
  const path = `stations[${String(index)}]`;
  const item = record(value, path);
  return { station_id: stringAt(item.station_id, `${path}.station_id`), line_id: stringAt(item.line_id, `${path}.line_id`), group_id: stringAt(item.group_id, `${path}.group_id`), name: stringAt(item.name, `${path}.name`), lat: numberAt(item.lat, `${path}.lat`), lng: numberAt(item.lng, `${path}.lng`) };
}

function parseEdge(value: unknown, index: number): AdjacencyEdge {
  const path = `adjacency[${String(index)}]`;
  const item = record(value, path);
  return { from: stringAt(item.from, `${path}.from`), to: stringAt(item.to, `${path}.to`), distance_m: nonNegativeNumberAt(item.distance_m, `${path}.distance_m`) };
}

function parseVersion(value: unknown): 1 {
  if (value !== 1) fail("format_version", "1");
  return 1;
}

export function parseTopologyGraph(input: unknown): TopologyGraphAsset {
  const asset = record(input, "input");
  return { format_version: parseVersion(asset.format_version), generated_at: isoStringAt(asset.generated_at, "generated_at"), sources: arrayAt(asset.sources, "sources").map((item, index) => parseSource(item, index)), lines: arrayAt(asset.lines, "lines").map((item, index) => parseLine(item, index)), stations: arrayAt(asset.stations, "stations").map((item, index) => parseStation(item, index)), adjacency: arrayAt(asset.adjacency, "adjacency").map((item, index) => parseEdge(item, index)) };
}
