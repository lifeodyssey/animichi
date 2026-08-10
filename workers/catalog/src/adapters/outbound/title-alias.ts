/**
 * Outbound adapter for the `TitleAliasPort`: exact alias lookup plus stored
 * candidate enrichment over the Neon alias index and `bangumi` rows. This
 * adapter owns the only SQL on the resolve path; resolution policy stays in
 * the application use case (`application/resolve-bangumi.ts`).
 */

import { sql } from "drizzle-orm";
import { nullableString, requiredNumber, requiredString } from "../../lib/rows";
import { candidateFromRow, type AliasWork, type TitleAliasPort } from "../../application/resolve-bangumi";
import type { BangumiRow } from "../../enrich/parse";
import type { AnimeCandidate } from "../../types";

/** The one DB capability this adapter needs: run a query, get back `{ rows }`. */
export interface AliasDb {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Build the `TitleAliasPort` backed by `db` (two parameterised SELECTs). */
export function titleAlias(db: AliasDb): TitleAliasPort {
  return {
    worksForAlias: (normalized) => selectAliasWorks(db, normalized),
    candidatesForWorks: (workIds) => selectCandidates(db, workIds),
  };
}

async function selectAliasWorks(db: AliasDb, normalized: string): Promise<AliasWork[]> {
  const result = await db.execute(sql`
    SELECT bangumi_id, MAX(priority) AS priority
    FROM aliases WHERE alias_normalized = ${normalized}
    GROUP BY bangumi_id
  `);
  return result.rows.map(readAliasWork);
}

async function selectCandidates(db: AliasDb, workIds: string[]): Promise<AnimeCandidate[]> {
  const result = await db.execute(sql`
    SELECT b.id, b.title, b.title_cn, b.cover_url, b.air_date,
           COUNT(p.id) AS points_count
    FROM bangumi b LEFT JOIN points p ON p.bangumi_id = b.id
    WHERE b.id IN (${sql.join(workIds, sql`, `)})
    GROUP BY b.id, b.title, b.title_cn, b.cover_url, b.air_date
  `);
  return result.rows.map(readStoredCandidate);
}

function readAliasWork(row: Record<string, unknown>): AliasWork {
  return { bangumi_id: requiredString(row, "bangumi_id"), priority: requiredNumber(row, "priority") };
}

/** Map a stored row to a candidate, deriving `year` and the point count. */
function readStoredCandidate(row: Record<string, unknown>): AnimeCandidate {
  return candidateFromRow(parsedRow(row), requiredNumber(row, "points_count"));
}

function parsedRow(row: Record<string, unknown>): BangumiRow {
  return {
    id: requiredString(row, "id"),
    title: requiredString(row, "title"),
    title_cn: nullableString(row, "title_cn"),
    cover_url: nullableString(row, "cover_url"),
    air_date: nullableString(row, "air_date"),
    ...emptyEnrichment(),
  };
}

function emptyEnrichment() {
  return { summary: null, rating: null, eps_count: null };
}
