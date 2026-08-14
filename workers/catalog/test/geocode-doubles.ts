import { vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import type { GeocodeHit } from "../src/domain/geocode/collapse";

export const NISHINOMIYA: GeocodeHit = {
  id: "seed:nishinomiya-station",
  name: "西宮駅",
  kind: "station",
  latitude: 34.7386,
  longitude: 135.3485,
  source: "manual",
  pref: "兵庫県",
  priority: 100,
  exact: true,
};

export interface FakeDb extends CatalogDb {
  executeSpy: ReturnType<typeof vi.fn>;
}

/** A fake CatalogDb recording every `execute` call and replaying scripted rows.
 *  The DB is the oracle for SQL semantics (distinct on / order by / trigram):
 *  return rows in the order a real query would, and assert the adapter echoes
 *  them — never rendered-SQL strings (Spec Testing Decisions + STORY 24). */
export function fakeDb(...responses: GeocodeHit[][]): FakeDb {
  const pending = [...responses];
  const executeSpy = vi.fn((_query: unknown) =>
    Promise.resolve({ rows: pending.shift() ?? [] }),
  );
  return {
    execute: executeSpy,
    executeSpy,
  } as unknown as FakeDb;
}

export function hit(overrides: Partial<GeocodeHit>): GeocodeHit {
  return { ...NISHINOMIYA, ...overrides };
}

/** The bound-parameter list of a recorded statement — the behavioural data a
 *  real query sends. Allows asserting semantic inputs (alias term, trigram
 *  threshold, result limit) without asserting rendered-SQL text. */
export function queryParams(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null) return [];
  const builder = value as { getSQL?: () => SQL };
  const sql = builder.getSQL ? builder.getSQL() : (value as SQL);
  return new PgDialect().sqlToQuery(sql).params;
}
