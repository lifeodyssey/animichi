/**
 * Version garbage collection over `cluster_version`
 * (`migrations/neon/20260623000001_init.sql`).
 *
 * Keeps the newest `keep` versions for a work and deletes the rest. The current
 * row (is_current=true) is NEVER deleted, even if it falls outside the keep
 * window — the live pointer must always survive. Itinerary snapshots are not touched:
 * they are immutable and intentionally outlive their version (no-drift), so a GC'd
 * version's snapshot still reads back unchanged.
 *
 * The statement is built with the Drizzle query builder; the keep-window is a
 * derived subquery (`MIN(version) over the newest-kept set`) that the builder
 * does not model first-class, so it is composed as a narrowly scoped fragment
 * inside the DELETE (atomic capability carve-out — see `../db/expressions`).
 */
import { and, desc, eq, lt, sql, type SQL } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { statementBuilder } from "../db/client";
import { clusterVersion } from "../db/schema";

/** Delete non-current versions older than the newest `keep`; returns count deleted. */
export async function gcOldVersions(db: CatalogDb, bangumiId: string, keep: number): Promise<number> {
  if (keep < 1) throw new Error("keep must be >= 1");
  const rows = (await db.execute(gcStatement(bangumiId, keep))).rows as { id: number }[];
  return rows.length;
}

/** The keep-window delete, as a typed builder statement. */
function gcStatement(bangumiId: string, keep: number): SQL {
  const keptMin = sql`(SELECT MIN(version) FROM (${newestKept(bangumiId, keep)}) AS kept)`;
  return statementBuilder()
    .delete(clusterVersion)
    .where(and(
      eq(clusterVersion.bangumiId, bangumiId),
      sql`NOT ${clusterVersion.isCurrent}`,
      lt(clusterVersion.version, keptMin),
    ))
    .returning({ id: clusterVersion.id })
    .getSQL();
}

/** The newest `keep` version rows for the work (the keep window). */
function newestKept(bangumiId: string, keep: number): SQL {
  return statementBuilder()
    .select({ version: clusterVersion.version })
    .from(clusterVersion)
    .where(eq(clusterVersion.bangumiId, bangumiId))
    .orderBy(desc(clusterVersion.version))
    .limit(keep)
    .getSQL();
}
