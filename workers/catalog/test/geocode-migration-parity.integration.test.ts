import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { SEED_ALIASES, SEED_LOCATIONS } from "./fixtures/geocode-seed";

/**
 * Pure-filesystem suite proving the geocode seed fixture stays in parity with the schema this
 * suite actually builds — the frozen Drizzle-era shape `@animichi/test-postgres` installs, which
 * is what this query layer still reads until #1629–#1631 move it. Seed rows are not embedded in
 * that shape (the gazetteer seed is a documented load path); this test pins the table shapes the
 * fixture relies on and forbids seed drift back into it. It runs in the Node integration pool
 * because the workerd pool cannot read outside workers/catalog.
 */

const SCHEMA = new URL("../../../packages/test-postgres/sql/drizzle-era-catalog.sql", import.meta.url);

function tableDefinition(table: string): string {
  const sql = readFileSync(SCHEMA, "utf8");
  const at = sql.indexOf(`CREATE TABLE public.${table} (`);
  if (at === -1) throw new Error(`the installed schema defines no table ${table}`);
  return sql.slice(at, sql.indexOf(");", at));
}

describe("catalog geocode schema parity", () => {
  it("A9 locations table shape matches the fixture and carries no embedded seed", () => {
    const sql = tableDefinition("locations");
    for (const column of ["id", "name", "kind", "latitude", "longitude", "source", "pref"]) {
      expect(sql).toContain(column);
    }
    expect(Object.keys(SEED_LOCATIONS)).toHaveLength(20);
    expect(sql).not.toMatch(/INSERT INTO locations/i);
  });

  it("A9 location_aliases table shape matches the fixture and carries no embedded seed", () => {
    const sql = tableDefinition("location_aliases");
    for (const column of ["alias", "alias_normalized", "location_id", "priority"]) {
      expect(sql).toContain(column);
    }
    expect(SEED_ALIASES).toHaveLength(30);
    expect(sql).not.toMatch(/INSERT INTO location_aliases/i);
  });
});
