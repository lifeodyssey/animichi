import { readdirSync, readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { SEED_ALIASES, SEED_LOCATIONS } from "./fixtures/geocode-seed";

/**
 * Pure-filesystem spike proving the geocode seed fixture stays in parity with
 * the rebuilt one-CREATE-per-table migration chain. Seed rows are no longer
 * embedded in migrations (the gazetteer seed is a documented load path); this
 * test pins the table shapes the fixture relies on and forbids seed drift back
 * into the chain. It runs in the Node spike pool because the workerd pool
 * cannot read outside workers/catalog.
 */

const MIGRATIONS = new URL("../../../migrations/neon/", import.meta.url);

function migrationDefining(table: string): string {
  const file = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .find((name) => {
      const sql = readFileSync(new URL(name, MIGRATIONS), "utf8");
      return sql.includes(`CREATE TABLE public.${table}`);
    });
  if (!file) throw new Error(`no migration defines table ${table}`);
  return readFileSync(new URL(file, MIGRATIONS), "utf8");
}

describe("catalog geocode migration parity", () => {
  it("A9 locations table shape matches the fixture and carries no embedded seed", () => {
    const sql = migrationDefining("locations");
    for (const column of ["id", "name", "kind", "latitude", "longitude", "source", "pref"]) {
      expect(sql).toContain(column);
    }
    expect(Object.keys(SEED_LOCATIONS)).toHaveLength(20);
    expect(sql).not.toMatch(/INSERT INTO locations/i);
  });

  it("A9 location_aliases table shape matches the fixture and carries no embedded seed", () => {
    const sql = migrationDefining("location_aliases");
    for (const column of ["alias", "alias_normalized", "location_id", "priority"]) {
      expect(sql).toContain(column);
    }
    expect(SEED_ALIASES).toHaveLength(30);
    expect(sql).not.toMatch(/INSERT INTO location_aliases/i);
  });
});
