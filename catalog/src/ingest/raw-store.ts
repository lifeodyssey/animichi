/**
 * Raw-zone storage for the ingest pipeline.
 *
 * UPSERTs upstream payloads verbatim into `raw_anitabi` / `raw_bangumi`
 * (`supabase/migrations/20260620230000_ingest_infrastructure.sql`):
 *   work_id (PK), payload JSONB, fetched_at.
 *
 * The raw zone is the replayable source of truth — it is written once per fetch
 * and NEVER read by the serving path; enrich/publish re-derive from it. Writes
 * go through raw `sql` (the Drizzle schema is query-only), `ON CONFLICT (work_id)
 * DO UPDATE` so a re-fetch overwrites the payload and bumps fetched_at.
 */
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";

/** A JSON-serializable upstream payload (object or array at the top level). */
export type RawPayload = Record<string, unknown> | unknown[];

/** UPSERT the raw Anitabi points payload for a work. */
export async function saveRawAnitabi(
  db: CatalogDb,
  workId: string,
  payload: RawPayload,
): Promise<void> {
  await upsertRaw(db, "raw_anitabi", workId, payload);
}

/** UPSERT the raw Bangumi subject payload for a work. */
export async function saveRawBangumi(
  db: CatalogDb,
  workId: string,
  payload: RawPayload,
): Promise<void> {
  await upsertRaw(db, "raw_bangumi", workId, payload);
}

/** Shared UPSERT into a raw JSONB table keyed by work_id. */
async function upsertRaw(
  db: CatalogDb,
  table: "raw_anitabi" | "raw_bangumi",
  workId: string,
  payload: RawPayload,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO ${sql.raw(table)} (work_id, payload, fetched_at)
    VALUES (${workId}, ${JSON.stringify(payload)}::jsonb, NOW())
    ON CONFLICT (work_id)
    DO UPDATE SET payload = EXCLUDED.payload, fetched_at = NOW()
  `);
}
