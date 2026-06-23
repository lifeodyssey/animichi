import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { SQL } from "drizzle-orm";
import * as schema from "./schema";

export type CatalogDb = NeonHttpDatabase<typeof schema>;
export type NeonSql = NeonQueryFunction<false, false>;
/** Minimal structural type for functions that only call `.execute()` (db or tx). */
export type DbExecutor = { execute: (query: SQL) => Promise<{ rows: unknown[] }> };

export function makeDb(connStr: string): CatalogDb {
  const sql = neon(connStr);
  return drizzle(sql, { schema });
}

export function makeNeonSql(connStr: string): NeonSql {
  return neon(connStr);
}
