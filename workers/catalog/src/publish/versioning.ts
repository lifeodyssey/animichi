/**
 * Atomic version publish over `cluster_version`
 * (`migrations/neon/20260623000001_init.sql`):
 *   id, bangumi_id, version, is_current, created_at, with the partial unique index
 *   `uq_cluster_version_one_current` (bangumi_id) WHERE is_current.
 *
 * A publish is a blue/green pointer switch done in ONE server-side batch
 * transaction: flip any current row to is_current=false, THEN insert the new row
 * with is_current=true. The flip-then-insert order is mandatory — reversing it
 * would momentarily leave two current rows and violate the partial unique index.
 * The batch makes the swap all-or-nothing, so a reader never sees zero or two
 * current rows.
 *
 * Statements are built with the Drizzle query builder + the typed expression
 * helpers (`../db/expressions`), then executed through the single `CatalogDb`
 * seam (`db.batch` / `db.execute`), consistent with the #992 one-adapter-seam
 * cutover (story 10).
 */
import { and, eq, type SQL } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { statementBuilder } from "../db/client";
import { clusterVersion } from "../db/schema";
import { nextVersionFor } from "../db/expressions";

interface PublishedVersionRow extends Record<string, unknown> {
  version: number;
}

/** Publish a new version for a work; returns the new version number. */
export async function publishVersion(db: CatalogDb, bangumiId: string): Promise<number> {
  const [flip, insert] = publishVersionStatements(bangumiId);
  const [, inserted] = await db.batch([
    db.execute(flip),
    db.execute<PublishedVersionRow>(insert),
  ]);
  return readPublishedVersion(inserted);
}

/** Ordered flip + insert statements shared by standalone and enrich batches. */
export function publishVersionStatements(
  bangumiId: string,
): readonly [SQL, SQL<PublishedVersionRow>] {
  return [flipCurrentOff(bangumiId), insertCurrent(bangumiId)];
}

/** Flip the work's current row (if any) to is_current=false. */
function flipCurrentOff(bangumiId: string): SQL {
  return statementBuilder()
    .update(clusterVersion)
    .set({ isCurrent: false })
    .where(and(eq(clusterVersion.bangumiId, bangumiId), eq(clusterVersion.isCurrent, true)))
    .getSQL();
}

/** Atomically derive and insert max(version)+1 (1 when no row exists). */
function insertCurrent(bangumiId: string): SQL<PublishedVersionRow> {
  return statementBuilder()
    .insert(clusterVersion)
    .values({ bangumiId, version: nextVersionFor(bangumiId), isCurrent: true })
    .returning({ version: clusterVersion.version }) as unknown as SQL<PublishedVersionRow>;
}

/** Read and validate the INSERT ... RETURNING version batch result. */
export function readPublishedVersion(result: { rows: unknown[] }): number {
  const row = result.rows[0];
  if (typeof row !== "object" || row === null || !("version" in row)) {
    throw new Error("publish batch returned no version");
  }
  if (typeof row.version !== "number") throw new Error("publish batch returned an invalid version");
  return row.version;
}
