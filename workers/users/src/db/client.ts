import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { SQL } from "drizzle-orm";
import * as schema from "./schema";

/** Typed Drizzle database; the single seam for saved-route statements. */
export type UsersDb = NeonHttpDatabase<typeof schema>;
/** Minimal executor surface (kept for tests that script raw rows). */
export interface DbExecutor {
  execute: (query: SQL) => Promise<{ rows: unknown[] }>;
}

/** Create the Neon HTTP-backed Users database. */
export function makeDb(connStr: string): UsersDb {
  return drizzle(neon(connStr), { schema });
}
