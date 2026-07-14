/** Build the deterministic PR-B gazetteer Atlas data migration and audit CSV. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL as NodeURL } from "node:url";
import { normalizeAlias } from "../src/lib/alias";

export type Kind = "station" | "city" | "ward" | "prefecture";
type Source = "mlit" | "geonames" | "manual";
type Lang = "ja" | "zh" | "en";
type Point = readonly [lng: number, lat: number];

export interface LocationRow { id: string; name: string; kind: Kind; lat: number; lng: number; source: Source; pref: string | null; featureCode?: string }
export interface AliasRow { alias: string; normalized: string; locationId: string; lang: Lang; priority: number }
export interface Gazetteer { locations: LocationRow[]; aliases: AliasRow[] }
export interface Prefecture { jis: string; name: string; zh: string; en: string; capital: string; lat: number; lng: number; admin1: string }

interface StationFeature { geometry?: { type?: string; coordinates?: unknown }; properties?: { N02_005?: unknown } }
interface StationCollection { type?: string; features?: unknown }
type CityNames = Record<string, { ja?: string; zh?: string }>;
interface BuildInput { stations: unknown; cities: string; cityNames: CityNames; prefectures?: readonly Prefecture[] }
interface CliOptions { stations: string; cities: string; outSql: string; outAudit: string; updateSources: boolean }
interface SourceHashes { stations: string; cities: string }
type CityColumns = string[] & { 0: string; 1: string; 4: string; 5: string };
export const CANONICAL_COMMAND = "node --import tsx workers/catalog/scripts/build-gazetteer.ts --stations data/raw/N02-23_Station.geojson --cities data/raw/cities500.txt --out-sql db/migrations/20260714000002_gazetteer_data.sql --out-audit workers/catalog/data/gazetteer-audit.csv";
const SOURCE_LOCK_PATH = fileURLToPath(new NodeURL("../data/gazetteer-sources.json", import.meta.url));
export const PREFECTURES: readonly Prefecture[] = [
  { jis: "01", name: "北海道", zh: "北海道", en: "Hokkaido", capital: "札幌市", lat: 43.0642, lng: 141.3469, admin1: "12" },
  { jis: "02", name: "青森県", zh: "青森县", en: "Aomori", capital: "青森市", lat: 40.8244, lng: 140.74, admin1: "03" },
  { jis: "03", name: "岩手県", zh: "岩手县", en: "Iwate", capital: "盛岡市", lat: 39.7036, lng: 141.1527, admin1: "16" },
  { jis: "04", name: "宮城県", zh: "宫城县", en: "Miyagi", capital: "仙台市", lat: 38.2688, lng: 140.8721, admin1: "24" },
  { jis: "05", name: "秋田県", zh: "秋田县", en: "Akita", capital: "秋田市", lat: 39.7186, lng: 140.1024, admin1: "02" },
  { jis: "06", name: "山形県", zh: "山形县", en: "Yamagata", capital: "山形市", lat: 38.2404, lng: 140.3633, admin1: "44" },
  { jis: "07", name: "福島県", zh: "福岛县", en: "Fukushima", capital: "福島市", lat: 37.7503, lng: 140.4676, admin1: "08" },
  { jis: "08", name: "茨城県", zh: "茨城县", en: "Ibaraki", capital: "水戸市", lat: 36.3418, lng: 140.4468, admin1: "14" },
  { jis: "09", name: "栃木県", zh: "枥木县", en: "Tochigi", capital: "宇都宮市", lat: 36.5657, lng: 139.8836, admin1: "38" },
  { jis: "10", name: "群馬県", zh: "群马县", en: "Gunma", capital: "前橋市", lat: 36.3912, lng: 139.0609, admin1: "10" },
  { jis: "11", name: "埼玉県", zh: "埼玉县", en: "Saitama", capital: "さいたま市", lat: 35.8569, lng: 139.6489, admin1: "34" },
  { jis: "12", name: "千葉県", zh: "千叶县", en: "Chiba", capital: "千葉市", lat: 35.6047, lng: 140.1233, admin1: "04" },
  { jis: "13", name: "東京都", zh: "东京都", en: "Tokyo", capital: "東京", lat: 35.6895, lng: 139.6917, admin1: "40" },
  { jis: "14", name: "神奈川県", zh: "神奈川县", en: "Kanagawa", capital: "横浜市", lat: 35.4478, lng: 139.6425, admin1: "19" },
  { jis: "15", name: "新潟県", zh: "新潟县", en: "Niigata", capital: "新潟市", lat: 37.9026, lng: 139.0236, admin1: "29" },
  { jis: "16", name: "富山県", zh: "富山县", en: "Toyama", capital: "富山市", lat: 36.6953, lng: 137.2113, admin1: "42" },
  { jis: "17", name: "石川県", zh: "石川县", en: "Ishikawa", capital: "金沢市", lat: 36.5947, lng: 136.6256, admin1: "15" },
  { jis: "18", name: "福井県", zh: "福井县", en: "Fukui", capital: "福井市", lat: 36.0652, lng: 136.2216, admin1: "06" },
  { jis: "19", name: "山梨県", zh: "山梨县", en: "Yamanashi", capital: "甲府市", lat: 35.6642, lng: 138.5684, admin1: "46" },
  { jis: "20", name: "長野県", zh: "长野县", en: "Nagano", capital: "長野市", lat: 36.6513, lng: 138.181, admin1: "27" },
  { jis: "21", name: "岐阜県", zh: "岐阜县", en: "Gifu", capital: "岐阜市", lat: 35.3912, lng: 136.7223, admin1: "09" },
  { jis: "22", name: "静岡県", zh: "静冈县", en: "Shizuoka", capital: "静岡市", lat: 34.9769, lng: 138.3831, admin1: "37" },
  { jis: "23", name: "愛知県", zh: "爱知县", en: "Aichi", capital: "名古屋市", lat: 35.1802, lng: 136.9066, admin1: "01" },
  { jis: "24", name: "三重県", zh: "三重县", en: "Mie", capital: "津市", lat: 34.7303, lng: 136.5086, admin1: "23" },
  { jis: "25", name: "滋賀県", zh: "滋贺县", en: "Shiga", capital: "大津市", lat: 35.0045, lng: 135.8686, admin1: "35" },
  { jis: "26", name: "京都府", zh: "京都府", en: "Kyoto", capital: "京都市", lat: 35.0214, lng: 135.7556, admin1: "22" },
  { jis: "27", name: "大阪府", zh: "大阪府", en: "Osaka", capital: "大阪市", lat: 34.6863, lng: 135.52, admin1: "32" },
  { jis: "28", name: "兵庫県", zh: "兵库县", en: "Hyogo", capital: "神戸市", lat: 34.6913, lng: 135.183, admin1: "13" },
  { jis: "29", name: "奈良県", zh: "奈良县", en: "Nara", capital: "奈良市", lat: 34.6853, lng: 135.8327, admin1: "28" },
  { jis: "30", name: "和歌山県", zh: "和歌山县", en: "Wakayama", capital: "和歌山市", lat: 34.226, lng: 135.1675, admin1: "43" },
  { jis: "31", name: "鳥取県", zh: "鸟取县", en: "Tottori", capital: "鳥取市", lat: 35.5039, lng: 134.2383, admin1: "41" },
  { jis: "32", name: "島根県", zh: "岛根县", en: "Shimane", capital: "松江市", lat: 35.4723, lng: 133.0505, admin1: "36" },
  { jis: "33", name: "岡山県", zh: "冈山县", en: "Okayama", capital: "岡山市", lat: 34.6618, lng: 133.935, admin1: "31" },
  { jis: "34", name: "広島県", zh: "广岛县", en: "Hiroshima", capital: "広島市", lat: 34.3966, lng: 132.4596, admin1: "11" },
  { jis: "35", name: "山口県", zh: "山口县", en: "Yamaguchi", capital: "山口市", lat: 34.1861, lng: 131.4705, admin1: "45" },
  { jis: "36", name: "徳島県", zh: "德岛县", en: "Tokushima", capital: "徳島市", lat: 34.0658, lng: 134.5593, admin1: "39" },
  { jis: "37", name: "香川県", zh: "香川县", en: "Kagawa", capital: "高松市", lat: 34.3401, lng: 134.0434, admin1: "17" },
  { jis: "38", name: "愛媛県", zh: "爱媛县", en: "Ehime", capital: "松山市", lat: 33.8417, lng: 132.7661, admin1: "05" },
  { jis: "39", name: "高知県", zh: "高知县", en: "Kochi", capital: "高知市", lat: 33.5597, lng: 133.5311, admin1: "20" },
  { jis: "40", name: "福岡県", zh: "福冈县", en: "Fukuoka", capital: "福岡市", lat: 33.6064, lng: 130.4183, admin1: "07" },
  { jis: "41", name: "佐賀県", zh: "佐贺县", en: "Saga", capital: "佐賀市", lat: 33.2494, lng: 130.2988, admin1: "33" },
  { jis: "42", name: "長崎県", zh: "长崎县", en: "Nagasaki", capital: "長崎市", lat: 32.7448, lng: 129.8737, admin1: "26" },
  { jis: "43", name: "熊本県", zh: "熊本县", en: "Kumamoto", capital: "熊本市", lat: 32.7898, lng: 130.7417, admin1: "21" },
  { jis: "44", name: "大分県", zh: "大分县", en: "Oita", capital: "大分市", lat: 33.2382, lng: 131.6126, admin1: "30" },
  { jis: "45", name: "宮崎県", zh: "宫崎县", en: "Miyazaki", capital: "宮崎市", lat: 31.9111, lng: 131.4239, admin1: "25" },
  { jis: "46", name: "鹿児島県", zh: "鹿儿岛县", en: "Kagoshima", capital: "鹿児島市", lat: 31.5602, lng: 130.5581, admin1: "18" },
  { jis: "47", name: "沖縄県", zh: "冲绳县", en: "Okinawa", capital: "那覇市", lat: 26.2124, lng: 127.6809, admin1: "47" },
];

const japanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const municipality = /[市区町村]$/u;
const priority: Readonly<Record<Kind, number>> = { station: 0, ward: 5, city: 10, prefecture: 20 };
function midpoint(feature: StationFeature): Point | null {
  if (feature.geometry?.type !== "LineString" || !Array.isArray(feature.geometry.coordinates)) return null;
  const points = feature.geometry.coordinates.filter(isPoint);
  if (!points.length) return null;
  return centroid(points);
}

function isPoint(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number";
}
function centroid(points: readonly Point[]): Point {
  const total = points.reduce<Point>(([x, y], [lng, lat]) => [x + lng, y + lat], [0, 0]);
  return [total[0] / points.length, total[1] / points.length];
}

function distance(a: Point, b: Point): number {
  const p = Math.PI / 180;
  const h = Math.sin((b[1] - a[1]) * p / 2) ** 2 + Math.cos(a[1] * p) * Math.cos(b[1] * p) * Math.sin((b[0] - a[0]) * p / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(h));
}

function clusters(points: readonly Point[]): Point[][] {
  const groups: Point[][] = [];
  for (const point of [...points].sort(comparePoint)) {
    const hits = groups.filter((group) => group.some((member) => distance(member, point) <= 500));
    if (!hits.length) groups.push([point]);
    else mergeGroups(groups, hits, point);
  }
  return groups;
}

function mergeGroups(groups: Point[][], hits: Point[][], point: Point): void {
  const merged = [point, ...hits.flat()].sort(comparePoint);
  for (const hit of hits) groups.splice(groups.indexOf(hit), 1);
  groups.push(merged);
}

function comparePoint(a: Point, b: Point): number { return a[0] - b[0] || a[1] - b[1]; }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 16); }
function rounded(value: number): number { return Number(value.toFixed(6)); }
function stationRows(raw: unknown): Gazetteer {
  const byName = new Map<string, Point[]>();
  const collection = raw as StationCollection;
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) throw new Error("stations must be a GeoJSON FeatureCollection");
  for (const item of collection.features) collectStation(byName, item as StationFeature);
  return stationGazetteer(byName);
}

function collectStation(byName: Map<string, Point[]>, feature: StationFeature): void {
  const name = feature.properties?.N02_005;
  const point = midpoint(feature);
  if (typeof name !== "string" || !name.trim() || !point) return;
  byName.set(name, [...(byName.get(name) ?? []), point]);
}

function stationGazetteer(byName: ReadonlyMap<string, Point[]>): Gazetteer {
  const result: Gazetteer = { locations: [], aliases: [] };
  for (const [name, points] of [...byName].sort(([a], [b]) => compareText(a, b))) {
    for (const group of clusters(points)) addStation(result, name, centroid(group));
  }
  return result;
}

function addStation(result: Gazetteer, name: string, point: Point): void {
  const [lng, lat] = point.map(rounded) as [number, number];
  const id = `mlit:st-${hash(`${name}\0${lat.toFixed(6)}\0${lng.toFixed(6)}`)}`;
  result.locations.push({ id, name, kind: "station", lat, lng, source: "mlit", pref: null });
  addAlias(result.aliases, id, name, "ja", 0);
  if (!name.endsWith("駅")) addAlias(result.aliases, id, `${name}駅`, "ja", 0);
}

function parseCities(text: string, names: CityNames, prefectures: readonly Prefecture[]): Gazetteer {
  const result: Gazetteer = { locations: [], aliases: [] };
  for (const line of text.split(/\r?\n/u)) addCity(result, line.split("\t"), names, prefectures);
  return result;
}

function addCity(result: Gazetteer, columns: string[], names: CityNames, prefectures: readonly Prefecture[]): void {
  if (!isJapanCity(columns)) return;
  const kind: Kind = columns[7]?.startsWith("PPLX") ? "ward" : "city";
  const alternates = (columns[3] ?? "").split(",").filter(Boolean);
  const name = japaneseName(columns[1], columns[2] ?? "", alternates, names);
  const location = cityLocation(columns, name, kind, prefectures);
  result.locations.push(location);
  addCityAliases(result.aliases, location, columns[1], alternates, names);
}

function isJapanCity(columns: string[]): columns is CityColumns {
  return columns[8] === "JP" && Boolean(columns[0] && columns[1] && columns[4] && columns[5]);
}
function cityLocation(columns: string[], name: string, kind: Kind, prefectures: readonly Prefecture[]): LocationRow {
  const pref = prefectures.find((item) => item.admin1 === columns[10])?.name ?? null;
  return { id: `geonames:${String(columns[0])}`, name, kind, lat: Number(columns[4]), lng: Number(columns[5]), source: "geonames", pref, featureCode: columns[7] };
}

function mappedNames(primary: string, ascii: string, names: CityNames): { ja?: string; zh?: string } {
  return names[primary] ?? names[ascii] ?? {};
}
function japaneseName(primary: string, ascii: string, alternates: string[], names: CityNames): string {
  if (japanese.test(primary)) return primary;
  const mapped = mappedNames(primary, ascii, names).ja;
  const matches = alternates.filter((name) => japanese.test(name) && (!mapped || name.replace(municipality, "") === mapped));
  return matches.find((name) => municipality.test(name)) ?? matches[0] ?? alternates.find((name) => japanese.test(name)) ?? primary;
}

function addCityAliases(rows: AliasRow[], location: LocationRow, primary: string, alternates: string[], names: CityNames): void {
  addAlias(rows, location.id, primary, /^[\p{ASCII}]+$/u.test(primary) ? "en" : "ja", priority[location.kind]);
  addAlias(rows, location.id, location.name, "ja", priority[location.kind]);
  const zh = findZhByJapanese(location.name, names);
  if (zh) addAlias(rows, location.id, zh, "zh", priority[location.kind]);
  const official = alternates.find((name) => name === location.name);
  if (official) addAlias(rows, location.id, official, "ja", priority[location.kind]);
}

function findZhByJapanese(name: string, names: CityNames): string | undefined {
  const base = name.replace(municipality, "");
  return Object.values(names).find((item) => item.ja === name || item.ja === base)?.zh;
}

function addPrefectures(result: Gazetteer, prefectures: readonly Prefecture[]): void {
  for (const pref of prefectures) {
    const id = `pref:${pref.jis}`;
    result.locations.push({ id, name: pref.name, kind: "prefecture", lat: pref.lat, lng: pref.lng, source: "manual", pref: pref.name });
    addAlias(result.aliases, id, pref.name, "ja", 20);
    addAlias(result.aliases, id, pref.zh, "zh", 20);
    addAlias(result.aliases, id, `${pref.en} Prefecture`, "en", 20);
    addCapitalAlias(result, pref);
  }
}

function addCapitalAlias(result: Gazetteer, pref: Prefecture): void {
  const capital = nearestCapital(result.locations, pref);
  if (!capital) {
    console.warn(`capital city not found within 15km: ${pref.name} (${pref.capital})`);
    return;
  }
  const capitalBare = pref.capital.replace(/市$/u, "");
  addAlias(result.aliases, capital.id, capitalBare, "ja", priority[capital.kind]);
  addAlias(result.aliases, capital.id, `${capitalBare}市`, "ja", priority[capital.kind]);
  addBarePrefectureAliases(result.aliases, capital, pref);
}

function addBarePrefectureAliases(rows: AliasRow[], capital: LocationRow, pref: Prefecture): void {
  const ja = pref.name.replace(/[都府県]$/u, "");
  const zh = pref.zh.replace(/[县都府]$/u, "");
  // 北海道 has no suffix, so its bare form equals the prefecture row; no dataset case exists.
  if (ja !== pref.name) addAlias(rows, capital.id, ja, "ja", priority[capital.kind]);
  if (normalizeAlias(zh) !== normalizeAlias(ja)) addAlias(rows, capital.id, zh, "zh", priority[capital.kind]);
  addAlias(rows, capital.id, pref.en.toLowerCase(), "en", priority[capital.kind]);
}

function nearestCapital(locations: readonly LocationRow[], pref: Prefecture): LocationRow | undefined {
  const candidates = locations.filter((item) => item.source === "geonames" && distance([item.lng, item.lat], [pref.lng, pref.lat]) <= 15_000);
  return candidates.sort((a, b) => Number(b.featureCode === "PPLA") - Number(a.featureCode === "PPLA")
    || distance([a.lng, a.lat], [pref.lng, pref.lat]) - distance([b.lng, b.lat], [pref.lng, pref.lat]))[0];
}

function addAlias(rows: AliasRow[], locationId: string, alias: string, lang: Lang, value: number): void {
  const normalized = normalizeAlias(alias);
  if (normalized) rows.push({ alias, normalized, locationId, lang, priority: value });
}

export function buildGazetteer(input: BuildInput): Gazetteer {
  const prefectures = input.prefectures ?? PREFECTURES;
  const stations = stationRows(input.stations);
  const cities = parseCities(input.cities, input.cityNames, prefectures);
  const result = { locations: [...stations.locations, ...cities.locations], aliases: [...stations.aliases, ...cities.aliases] };
  addPrefectures(result, prefectures);
  return sorted(result);
}

export function verifySourceHashes(actual: SourceHashes, expected: SourceHashes, updateSources = false): void {
  const keys: readonly (keyof SourceHashes)[] = ["stations", "cities"];
  const mismatches = keys.filter((key) => actual[key] !== expected[key]);
  if (!mismatches.length) return;
  const message = `gazetteer source SHA256 mismatch: ${mismatches.map((key) => `${key} expected ${expected[key]}, got ${actual[key]}`).join("; ")}`;
  if (!updateSources) throw new Error(message);
  console.warn(`${message}; continuing because --update-sources was supplied`);
}

export function validateGazetteer(result: Gazetteer): void {
  validateCoordinates(result.locations);
  const counts = countKinds(result.locations);
  if (counts.station < 9_000) throw new Error(`gazetteer station count ${String(counts.station)} is below 9000`);
  if (counts.city + counts.ward < 2_000) throw new Error(`gazetteer city+ward count ${String(counts.city + counts.ward)} is below 2000`);
  if (counts.prefecture !== 47) throw new Error(`gazetteer prefecture count must be 47, got ${String(counts.prefecture)}`);
  if (result.aliases.length < 20_000) throw new Error(`gazetteer alias count ${String(result.aliases.length)} is below 20000`);
}

function validateCoordinates(locations: readonly LocationRow[]): void {
  for (const row of locations) {
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) throw new Error(`gazetteer location ${row.id} has non-finite coordinates`);
    if (row.lat < 20 || row.lat > 50 || row.lng < 120 || row.lng > 155) throw new Error(`gazetteer location ${row.id} has out-of-range coordinates`);
  }
}

function countKinds(locations: readonly LocationRow[]): Record<Kind, number> {
  const counts: Record<Kind, number> = { station: 0, city: 0, ward: 0, prefecture: 0 };
  for (const row of locations) counts[row.kind] += 1;
  return counts;
}

function sorted(result: Gazetteer): Gazetteer {
  const locations = [...result.locations].sort((a, b) => compareText(a.id, b.id));
  const unique = new Map<string, AliasRow>();
  for (const row of result.aliases) if (!unique.has(`${row.normalized}\0${row.locationId}`)) unique.set(`${row.normalized}\0${row.locationId}`, row);
  const aliases = [...unique.values()].sort((a, b) => compareText(a.normalized, b.normalized) || compareText(a.locationId, b.locationId));
  return { locations, aliases };
}

function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function sqlString(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
function sqlValue(value: string | number | null): string { return value === null ? "NULL" : typeof value === "number" ? String(value) : sqlString(value); }
function batches<T>(rows: readonly T[]): T[][] { return Array.from({ length: Math.ceil(rows.length / 500) }, (_, index) => rows.slice(index * 500, index * 500 + 500)); }

export function renderSql(result: Gazetteer, metadata: { stationSha: string; citiesSha: string; command: string }): string {
  const header = `-- GENERATED ARTIFACT: exempt from the repository 300-line limit. Do not edit by hand.\n-- Sources: MLIT N02-2023 Station GeoJSON, retrieved 2026-07-14 (SHA256 ${metadata.stationSha}); GeoNames cities500, retrieved 2026-07-14 (SHA256 ${metadata.citiesSha}).\n-- Generation command: ${metadata.command}\n`;
  const locations = batches(result.locations).map((rows) => insert("locations", "id, name, kind, latitude, longitude, location, source, pref", rows.map(locationTuple))).join("\n\n");
  const aliases = batches(result.aliases).map((rows) => insert("location_aliases", "alias, alias_normalized, location_id, lang, priority", rows.map(aliasTuple))).join("\n\n");
  return `${header}\n${locations}\n\n${aliases}\n`;
}

function insert(table: string, columns: string, tuples: string[]): string {
  return `INSERT INTO ${table} (${columns}) VALUES\n${tuples.map((row) => `    ${row}`).join(",\n")}\nON CONFLICT DO NOTHING;`;
}

function locationTuple(row: LocationRow): string {
  return `(${[row.id, row.name, row.kind, row.lat, row.lng, null, row.source, row.pref].map(sqlValue).join(", ")})`;
}

function aliasTuple(row: AliasRow): string {
  return `(${[row.alias, row.normalized, row.locationId, row.lang, row.priority].map(sqlValue).join(", ")})`;
}

export function renderAudit(result: Gazetteer): string {
  const counts = new Map(result.locations.map((row) => [row.id, result.aliases.filter((alias) => alias.locationId === row.id).length]));
  const rows = result.locations.map((row) => [row.id, row.kind, row.name, row.lat, row.lng, counts.get(row.id) ?? 0].map(csvValue).join(","));
  const summary = (["station", "city", "ward", "prefecture"] as const).map((kind) => `${kind}=${String(result.locations.filter((row) => row.kind === kind).length)}`).join(";");
  return `id,kind,name,lat,lng,alias_count\n${rows.join("\n")}\nSUMMARY,${summary}\n`;
}

function csvValue(value: string | number): string { const text = String(value); return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function options(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]?.replace(/^--/u, "");
    if (key === "update-sources") { result[key] = true; continue; }
    const value = argv[index + 1];
    if (!key || !value) throw new Error("Usage: --stations <path> --cities <path> --out-sql <path> --out-audit <path> [--update-sources]");
    result[key] = value;
    index += 1;
  }
  return result;
}

function requiredOptions(args: Record<string, string | boolean>): CliOptions {
  const { stations, cities, "out-sql": outSql, "out-audit": outAudit } = args;
  if (typeof stations !== "string" || typeof cities !== "string" || typeof outSql !== "string" || typeof outAudit !== "string") throw new Error("missing required gazetteer generator option");
  return { stations, cities, outSql, outAudit, updateSources: args["update-sources"] === true };
}

async function main(): Promise<void> {
  const args = requiredOptions(options(process.argv.slice(2)));
  const namesPath = fileURLToPath(new NodeURL("../../../apps/agent/agent/agents/data/city_names_jp.json", import.meta.url));
  const [stationText, cityText, namesText, lockText] = await Promise.all([readFile(resolve(args.stations), "utf8"), readFile(resolve(args.cities), "utf8"), readFile(namesPath, "utf8"), readFile(SOURCE_LOCK_PATH, "utf8")]);
  const hashes = { stations: sha256(stationText), cities: sha256(cityText) };
  verifySourceHashes(hashes, JSON.parse(lockText) as SourceHashes, args.updateSources);
  const gazetteer = buildGazetteer({ stations: JSON.parse(stationText), cities: cityText, cityNames: JSON.parse(namesText) as CityNames });
  validateGazetteer(gazetteer);
  await Promise.all([publish(args.outSql, renderSql(gazetteer, { stationSha: hashes.stations, citiesSha: hashes.cities, command: CANONICAL_COMMAND })), publish(args.outAudit, renderAudit(gazetteer))]);
}

async function publish(path: string, contents: string): Promise<void> { await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(resolve(path), contents); }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
