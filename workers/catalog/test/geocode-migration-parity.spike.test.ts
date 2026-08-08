import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import type { GeocodeHit } from "../src/lib/geocode";
import { SEED_ALIASES, SEED_LOCATIONS } from "./fixtures/geocode-seed";

/**
 * Pure-filesystem spike proving the geocode seed fixture stays in parity with
 * the authoritative catalog-geocoding migration. It runs in the Node spike
 * pool because the workerd pool cannot read outside workers/catalog.
 */

const MIGRATION_SQL = readFileSync(
  new URL("../../../migrations/neon/20260714000001_catalog_geocoding.sql", import.meta.url),
  "utf8",
);

function insertValues(table: string): string {
  const pattern = new RegExp(`INSERT INTO ${table} \\([^;]+?\\) VALUES([\\s\\S]+?);`);
  const values = MIGRATION_SQL.match(pattern)?.[1];
  if (!values) throw new Error(`missing ${table} seed INSERT`);
  return values;
}

function migrationLocations(): typeof SEED_LOCATIONS {
  const rows: Record<string, (typeof SEED_LOCATIONS)[string]> = {};
  const tuple = /\('([^']+)', '([^']+)', '([^']+)', (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?), '([^']+)', '([^']+)'\)/g;
  for (const match of insertValues("locations").matchAll(tuple)) {
    const parsed = parsedLocation(match);
    if (parsed) rows[parsed.id] = parsed;
  }
  return rows;
}

function parsedLocation(match: RegExpExecArray): (typeof SEED_LOCATIONS)[string] | null {
  const [, id, name, kind, latitude, longitude, source, pref] = match;
  if (!id || !name || !kind || !latitude || !longitude || !source || !pref) return null;
  return {
    id, name,
    kind: kind as GeocodeHit["kind"],
    latitude: Number(latitude), longitude: Number(longitude), source: source as GeocodeHit["source"],
    pref,
  };
}

function migrationAliases(): readonly (readonly [string, string])[] {
  const aliases: [string, string][] = [];
  const tuple = /\('([^']+)', '([^']+)', '([^']+)', (?:'[^']+'|NULL), \d+\)/g;
  for (const match of insertValues("location_aliases").matchAll(tuple)) {
    const parsed = parsedAlias(match);
    if (parsed) aliases.push(parsed);
  }
  return aliases;
}

function parsedAlias(match: RegExpExecArray): [string, string] | null {
  const [, alias, normalized, locationId] = match;
  if (!alias || !normalized || !locationId) return null;
  expect(normalized).toBe(alias);
  return [alias, locationId];
}

describe("catalog geocode migration parity", () => {
  it("A9 mirrors the audited locations and aliases", () => {
    expect(migrationLocations()).toEqual(SEED_LOCATIONS);
    expect(migrationAliases()).toEqual(SEED_ALIASES);
  });
});
