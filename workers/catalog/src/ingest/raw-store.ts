/**
 * Raw-zone storage for the ingest pipeline.
 *
 * UPSERTs upstream payloads verbatim into `raw_anitabi` / `raw_bangumi`
 * (`migrations/neon/20260623000001_init.sql`):
 *   work_id (PK), payload JSONB, fetched_at.
 *
 * The raw zone is the replayable source of truth — it is written once per fetch
 * and NEVER read by the serving path; enrich/publish re-derive from it. Writes
 * go through the Drizzle query builder's `onConflictDoUpdate` over the single
 * CatalogDb seam, so a re-fetch overwrites the payload and bumps fetched_at.
 */
import { sql, type SQL } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { statementBuilder } from "../db/client";
import { rawAnitabi, rawBangumi } from "../db/schema";

/** A JSON-serializable upstream payload (object or array at the top level). */
export type RawPayload = Record<string, unknown> | unknown[];

/** The typed raw-zone table for a payload source. */
type RawTable = typeof rawAnitabi | typeof rawBangumi;

/** UPSERT the raw Anitabi points payload for a work. */
export async function saveRawAnitabi(
  db: CatalogDb,
  bangumiId: string,
  payload: RawPayload,
): Promise<void> {
  await upsertRaw(db, rawAnitabi, bangumiId, payload);
}

/** UPSERT the raw Bangumi subject payload for a work. */
export async function saveRawBangumi(
  db: CatalogDb,
  bangumiId: string,
  payload: RawPayload,
): Promise<void> {
  await upsertRaw(db, rawBangumi, bangumiId, payload);
}

/** Shared UPSERT into a raw JSONB table keyed by work_id. */
async function upsertRaw(
  db: CatalogDb, table: RawTable,
  bangumiId: string, payload: RawPayload,
): Promise<void> {
  await db.execute(rawUpsertStatement(table, bangumiId, payload));
}

/** The UPSERT ... ON CONFLICT (work_id) DO UPDATE statement. */
function rawUpsertStatement(table: RawTable, bangumiId: string, payload: RawPayload): SQL {
  return statementBuilder()
    .insert(table)
    .values({ workId: bangumiId, payload: JSON.stringify(payload) })
    .onConflictDoUpdate({
      target: table.workId,
      set: { payload: sqlExprPayload(), fetchedAt: sqlExprNow() },
    })
    .getSQL();
}

/** `EXCLUDED.payload` — the proposed row's payload on conflict. */
function sqlExprPayload(): SQL {
  return sql`EXCLUDED.payload`;
}

/** `NOW()` — the raw-zone refetch timestamp. */
function sqlExprNow(): SQL {
  return sql`NOW()`;
}
