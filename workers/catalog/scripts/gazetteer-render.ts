import type { AliasRow, Gazetteer, LocationRow } from "./gazetteer-lib";

export function sorted(result: Gazetteer): Gazetteer {
  const locations = [...result.locations].sort((a, b) => compareText(a.id, b.id));
  const unique = new Map<string, AliasRow>();
  for (const row of result.aliases) if (!unique.has(`${row.normalized}\0${row.locationId}`)) unique.set(`${row.normalized}\0${row.locationId}`, row);
  const aliases = [...unique.values()].sort((a, b) => compareText(a.normalized, b.normalized) || compareText(a.locationId, b.locationId));
  return { locations, aliases };
}

export function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export function sqlString(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
export function sqlValue(value: string | number | null): string { return value === null ? "NULL" : typeof value === "number" ? String(value) : sqlString(value); }
export function batches<T>(rows: readonly T[]): T[][] { return Array.from({ length: Math.ceil(rows.length / 500) }, (_, index) => rows.slice(index * 500, index * 500 + 500)); }

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
