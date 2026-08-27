import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/neon-http";
import { describe, expect, it } from "vitest";
import { NeonIdempotencyStore } from "../src/adapters/neon-idempotency-store";
import type { UsersDb } from "../src/db/client";
import * as schema from "../src/db/schema";

// #1222 review: `targetWhere` renders into the conflict target's
// index-predicate slot, which a non-partial primary key silently absorbs —
// real Postgres then overwrites a committed row inside its retention window.
// The staleness predicate must ride the DO UPDATE's own WHERE (`setWhere`).
// Pinned by capturing the SQL the PRODUCTION `reclaim` emits (a local copy of
// the upsert config would keep passing after a regression in the adapter),
// because the in-memory fake cannot testify about this distinction: it
// faithfully reproduced the broken shape once.
const reclaimedRow = {
  state: "in_progress", fingerprint: "f", result: null,
  created_at: new Date(0), expires_at: new Date(0),
};

function recordingDb(capture: (sql: string) => void): UsersDb {
  const db = drizzle("postgres://probe:probe@sql-shape.invalid/db", { schema });
  const execute = (query: { getSQL(): SQL }) => {
    capture(new PgDialect().sqlToQuery(query.getSQL()).sql);
    return Promise.resolve({ rows: [reclaimedRow] });
  };
  db.execute = execute as UsersDb["execute"];
  return db;
}

async function productionReclaimSql(): Promise<string> {
  let sql = "";
  const store = new NeonIdempotencyStore(recordingDb((captured) => { sql = captured; }));
  await store.reclaim({
    ownerUserId: "u", op: "o", key: "k", fingerprint: "f",
    expiresAt: new Date(1_700_000_000_000).toISOString(), now: 1_700_000_000_000,
  });
  return sql;
}

describe("reclaim SQL shape", () => {
  it("puts the staleness predicate on DO UPDATE ... WHERE, never the conflict target", async () => {
    const sql = await productionReclaimSql();
    const doUpdateAt = sql.indexOf("do update set");
    const whereAt = sql.indexOf(" where ");
    expect(doUpdateAt).toBeGreaterThan(sql.indexOf("on conflict"));
    expect(whereAt).toBeGreaterThan(doUpdateAt);
    expect(sql).not.toMatch(/on conflict \([^)]+\) where /);
  });
});
