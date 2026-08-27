import { and, lte, ne, or } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/neon-http";
import { describe, expect, it } from "vitest";
import { savedRouteIdempotency } from "../src/db/schema";

// #1222 review: `targetWhere` renders into the conflict target's
// index-predicate slot, which a non-partial primary key silently absorbs —
// real Postgres then overwrites a committed row inside its retention window.
// The staleness predicate must ride the DO UPDATE's own WHERE (`setWhere`).
// Pinned at the generated-SQL level because the in-memory fake cannot testify
// about this distinction: it faithfully reproduced the broken shape once.
function reclaimSql(): string {
  const db = drizzle("postgres://probe:probe@sql-shape.invalid/db");
  const now = new Date(1_700_000_000_000);
  const staleBefore = new Date(1_699_999_990_000);
  const statement = db.insert(savedRouteIdempotency)
    .values({
      ownerUserId: "u", op: "o", key: "k", fingerprint: "f",
      result: null, resultId: null, createdAt: now, expiresAt: now,
    })
    .onConflictDoUpdate({
      target: [savedRouteIdempotency.ownerUserId, savedRouteIdempotency.op, savedRouteIdempotency.key],
      set: { fingerprint: "f", result: null, resultId: null, createdAt: now, expiresAt: now, state: "in_progress" },
      setWhere: or(
        lte(savedRouteIdempotency.expiresAt, now),
        and(ne(savedRouteIdempotency.state, "committed"), lte(savedRouteIdempotency.createdAt, staleBefore)),
      ),
    });
  return new PgDialect().sqlToQuery(statement.getSQL()).sql;
}

describe("reclaim SQL shape", () => {
  it("puts the staleness predicate on DO UPDATE ... WHERE, never the conflict target", () => {
    const sql = reclaimSql();
    const doUpdateAt = sql.indexOf("do update set");
    const whereAt = sql.indexOf(" where ");
    expect(doUpdateAt).toBeGreaterThan(sql.indexOf("on conflict"));
    expect(whereAt).toBeGreaterThan(doUpdateAt);
    expect(sql).not.toMatch(/on conflict \([^)]+\) where /);
  });
});
