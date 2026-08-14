import { vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { NeonGazetteer } from "../src/adapters/outbound/neon/gazetteer";
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

export function sqlText(value: unknown): string {
  if (typeof value !== "object" || value === null) return "";
  const builder = value as { getSQL?: () => SQL };
  const sql = builder.getSQL ? builder.getSQL() : (value as SQL);
  return new PgDialect().sqlToQuery(sql).sql;
}

export async function fuzzySql(): Promise<string> {
  const db = fakeDb([], []);
  await new NeonGazetteer(db).fuzzy("西宮北口");
  return sqlText(db.executeSpy.mock.calls[0]?.[0]);
}
