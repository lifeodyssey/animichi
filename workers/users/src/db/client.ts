import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { SQL } from "drizzle-orm";
import * as schema from "./schema";

/** Typed Drizzle database; queries still use only the raw SQL executor. */
export type UsersDb = NeonHttpDatabase<typeof schema>;
/** Minimal executor shared by production Drizzle and test fakes. */
export interface DbExecutor {
  execute: (query: SQL) => Promise<{ rows: unknown[] }>;
}

/** Create the Neon HTTP-backed Users database. */
export function makeDb(connStr: string): UsersDb {
  return drizzle(neon(connStr), { schema });
}
