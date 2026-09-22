/**
 * Raw-zone storage for the ingest pipeline.
 *
 * UPSERTs upstream payloads verbatim into `raw_anitabi` / `raw_bangumi`
 * (the data-plane contract):
 *   work_id (PK), payload JSONB, fetched_at.
 *
 * The raw zone is the replayable source of truth — it is written once per fetch
 * and NEVER read by the serving path; enrich/publish re-derive from it. The write
 * is the builder's INSERT plus the conflict clause it does not model
 * ({@link ../db/plans}), so a re-fetch overwrites the payload and bumps
 * `fetched_at` in one statement, exactly as `onConflictDoUpdate` did.
 *
 * `fetched_at` is not a bound value on either side of the conflict: the INSERT
 * omits it so the column's own `now()` default fills it, and the conflict branch
 * copies `EXCLUDED.fetched_at` — the proposed row's value, which is that same
 * default. The timestamp therefore stays the DATABASE's clock, which is what the
 * deleted `sql\`NOW()\`` expression asked for, and not the worker's.
 *
 * The payload is narrowed to the contract's `JsonValue` at this one boundary
 * ({@link ../lib/json}). `sources.ts` types what it fetches as
 * `Record<string, unknown>` because it narrows an upstream response field by
 * field; by the time a payload reaches here it is a value `JSON.parse` produced,
 * which is a `JsonValue` by construction and by the jsonb column it is about to
 * be written to.
 */
import type { JsonValue } from "@prisma/orm-postgres/contract/types";
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";
import { upsert } from "../db/plans";
import { asJsonValue } from "../lib/json";

/** A JSON-serializable upstream payload (object or array at the top level). */
export type RawPayload = Record<string, unknown> | unknown[];

/** The columns a re-fetch overwrites on an existing raw row. */
const RAW_UPDATE_COLUMNS = ["payload", "fetched_at"] as const;

/** UPSERT the raw Anitabi points payload for a work. */
export async function saveRawAnitabi(
  query: CatalogPrisma,
  bangumiId: string,
  payload: RawPayload,
): Promise<void> {
  await query.executor.query(anitabiUpsert(query, bangumiId, asJsonValue(payload)));
}

/** UPSERT the raw Bangumi subject payload for a work. */
export async function saveRawBangumi(
  query: CatalogPrisma,
  bangumiId: string,
  payload: RawPayload,
): Promise<void> {
  await query.executor.query(bangumiUpsert(query, bangumiId, asJsonValue(payload)));
}

/** The raw Anitabi UPSERT ... ON CONFLICT (work_id) DO UPDATE plan. */
function anitabiUpsert(query: CatalogPrisma, bangumiId: string, payload: JsonValue): SqlOrmPlan {
  const insert = query.builder.public.raw_anitabi
    .insert([{ work_id: bangumiId, payload }])
    .build();
  return upsert(insert, { target: ["work_id"], update: RAW_UPDATE_COLUMNS });
}

/** The raw Bangumi UPSERT ... ON CONFLICT (work_id) DO UPDATE plan. */
function bangumiUpsert(query: CatalogPrisma, bangumiId: string, payload: JsonValue): SqlOrmPlan {
  const insert = query.builder.public.raw_bangumi
    .insert([{ work_id: bangumiId, payload }])
    .build();
  return upsert(insert, { target: ["work_id"], update: RAW_UPDATE_COLUMNS });
}
