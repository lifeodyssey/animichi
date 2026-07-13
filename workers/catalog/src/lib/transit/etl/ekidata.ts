import { haversine } from "../../geo";
import type { AdjacencyEdge, RailCategory, TopologyLine, TopologyStation } from "../model";
import { parseCsv, type CsvRow } from "./csv";

/** Rail-path curvature applied to straight-line station distances. */
export const RAIL_CURVE_COEFFICIENT = 1.15;

export interface EkidataGraph {
  lines: TopologyLine[];
  stations: TopologyStation[];
  adjacency: AdjacencyEdge[];
}

export interface EkidataCsvs { company: string; line: string; station: string; join: string }
export interface ParseEkidataResult { graph: EkidataGraph; warnings: string[] }

interface Company { name: string; type: string }

const companyHeaders = ["company_cd", "company_name", "company_type"];
const lineHeaders = ["line_cd", "company_cd", "line_name", "e_status"];
const stationHeaders = ["station_cd", "station_g_cd", "station_name", "line_cd", "lon", "lat", "e_status"];
const joinHeaders = ["line_cd", "station_cd1", "station_cd2"];

function complete(row: CsvRow, fields: readonly string[]): boolean {
  return fields.every((field) => Boolean(row[field]));
}

function companies(rows: readonly CsvRow[], warnings: string[]): Map<string, Company> {
  const accepted = rows.filter((row) => complete(row, ["company_cd", "company_name", "company_type"]));
  warnings.push(...rows.filter((row) => !accepted.includes(row)).map((row) => `Dropped company ${row.company_cd ?? "<missing>"}: malformed row`));
  return new Map(accepted.map((row) => [row.company_cd ?? "", { name: row.company_name ?? "", type: row.company_type ?? "" }]));
}

/** Tunable free-tier heuristic used because ekidata CSVs omit line_type. */
function isTram(lineName: string, companyName: string): boolean {
  if (companyName.includes("広島電鉄")) return !lineName.includes("宮島");
  return lineName.includes("路面") || [lineName, companyName].some((name) => /市電|都電/u.test(name));
}

function isSubway(lineName: string, companyName: string): boolean {
  return [lineName, companyName].some((name) => /地下鉄|メトロ|市営|都営/u.test(name)) || companyName.includes("交通局");
}

export function inferRailCategory(lineName: string, companyName: string, companyType: string): RailCategory {
  if (lineName.includes("新幹線")) return "shinkansen";
  if (isTram(lineName, companyName)) return "tram";
  if (isSubway(lineName, companyName)) return "subway";
  return companyType === "1" ? "jr_conventional" : "private_rail";
}

function parseLine(row: CsvRow, companyMap: ReadonlyMap<string, Company>): TopologyLine {
  const company = companyMap.get(row.company_cd ?? "") ?? { name: "", type: "" };
  return { line_id: row.line_cd ?? "", name: row.line_name ?? "", category: inferRailCategory(row.line_name ?? "", company.name, company.type) };
}

function operationalLines(rows: readonly CsvRow[], companyMap: ReadonlyMap<string, Company>, warnings: string[]): TopologyLine[] {
  const operational = rows.filter((row) => row.e_status === "0");
  const accepted = operational.filter((row) => complete(row, ["line_cd", "company_cd", "line_name"]) && companyMap.has(row.company_cd ?? ""));
  warnings.push(...operational.filter((row) => !accepted.includes(row)).map((row) => `Dropped line ${row.line_cd ?? "<missing>"}: malformed row or missing company`));
  return accepted.map((row) => parseLine(row, companyMap));
}

function validCoordinate(row: CsvRow): boolean {
  return Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon));
}

function parseStation(row: CsvRow): TopologyStation {
  return { station_id: row.station_cd ?? "", group_id: row.station_g_cd ?? "", name: row.station_name ?? "", line_id: row.line_cd ?? "", lat: Number(row.lat), lng: Number(row.lon) };
}

function stationWarning(row: CsvRow): string {
  return `Dropped station ${row.station_cd ?? "<missing>"}: missing operational line or valid coordinates`;
}

function operationalStations(rows: readonly CsvRow[], lineIds: ReadonlySet<string>, warnings: string[]): TopologyStation[] {
  const fields = ["station_cd", "station_g_cd", "station_name", "line_cd"];
  const accepted = rows.filter((row) => row.e_status === "0" && complete(row, fields) && lineIds.has(row.line_cd ?? "") && validCoordinate(row));
  const dropped = rows.filter((row) => row.e_status === "0" && !accepted.includes(row));
  warnings.push(...dropped.map(stationWarning));
  return accepted.map(parseStation);
}

function edgeFor(row: CsvRow, stations: ReadonlyMap<string, TopologyStation>): AdjacencyEdge | null {
  const from = stations.get(row.station_cd1 ?? "");
  const to = stations.get(row.station_cd2 ?? "");
  if (!from || !to || from.line_id !== row.line_cd || to.line_id !== row.line_cd) return null;
  return { from: from.station_id, to: to.station_id, distance_m: Math.round(haversine(from.lat, from.lng, to.lat, to.lng) * RAIL_CURVE_COEFFICIENT) };
}

function adjacency(rows: readonly CsvRow[], stations: readonly TopologyStation[], warnings: string[]): AdjacencyEdge[] {
  const stationMap = new Map(stations.map((station) => [station.station_id, station]));
  const edges = rows.map((row) => edgeFor(row, stationMap));
  warnings.push(...rows.filter((_, index) => !edges[index]).map((row) => `Dropped join ${row.station_cd1 ?? "?"}→${row.station_cd2 ?? "?"}: station missing or line mismatch`));
  return edges.filter((edge): edge is AdjacencyEdge => edge !== null);
}

export function parseEkidata(csvs: EkidataCsvs): ParseEkidataResult {
  const warnings: string[] = [];
  const companyMap = companies(parseCsv(csvs.company, companyHeaders), warnings);
  const lines = operationalLines(parseCsv(csvs.line, lineHeaders), companyMap, warnings);
  const lineIds = new Set(lines.map((line) => line.line_id));
  const stations = operationalStations(parseCsv(csvs.station, stationHeaders), lineIds, warnings);
  const edges = adjacency(parseCsv(csvs.join, joinHeaders), stations, warnings);
  return { graph: { lines, stations, adjacency: edges }, warnings };
}
