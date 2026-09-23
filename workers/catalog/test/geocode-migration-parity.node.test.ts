import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { SEED_ALIASES, SEED_LOCATIONS } from "./fixtures/geocode-seed";

/**
 * Pure-filesystem suite proving the geocode seed fixture stays in parity with the table shapes it
 * assumes — the ones in the frozen pre-Prisma schema `@animichi/test-postgres` keeps as
 * `sql/drizzle-era-catalog.sql`. It reads that file as TEXT and builds no database of its own.
 *
 * The Drizzle query layer that schema records is retired (#1628–#1633); the schema file is not,
 * and this suite is one of its two remaining readers — the other one installs it
 * (`packages/agent/integration-test/catalog-postgres.ts`). Seed rows are not embedded in that
 * schema (the gazetteer seed is a documented load path); this test pins the table shapes the
 * fixture relies on and forbids seed drift back into it. It runs in the plain Node pool because
 * the workerd pool cannot read outside workers/catalog, and it opens no database.
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
