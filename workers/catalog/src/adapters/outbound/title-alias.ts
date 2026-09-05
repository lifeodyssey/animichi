/**
 * Outbound adapter for the `TitleAliasPort`: exact alias lookup plus stored
 * candidate enrichment over the Neon alias index and `bangumi` rows. This
 * adapter owns the only SQL on the resolve path; resolution policy stays in
 * the application use case (`application/resolve-bangumi.ts`).
 *
 * Statements are built with the Drizzle query builder + expression helpers and
 * executed through the single `CatalogDb` / `DbExecutor` seam.
 */
import { count, eq, inArray, max, sql, type SQL } from "drizzle-orm";
import { nullableString, requiredNumber, requiredString } from "../../lib/rows";
import { candidateFromRow, type AliasWork, type CandidateFields, type TitleAliasPort } from "../../application/resolve-bangumi";
import type { AnimeCandidate } from "../../types";
import { statementBuilder } from "../../db/client";
import { aliases, bangumi, points } from "../../db/schema";

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
  const result = await db.execute(aliasWorksStatement(normalized));
  return result.rows.map(readAliasWork);
}

/** MAX(priority) per bangumi for a normalized alias (the highest-priority alias). */
function aliasWorksStatement(normalized: string): SQL {
  return statementBuilder()
    .select({ bangumiId: aliases.bangumiId, priority: max(aliases.priority).as("priority") })
    .from(aliases)
    .where(eq(aliases.aliasNormalized, normalized))
    .groupBy(aliases.bangumiId)
    .getSQL();
}

async function selectCandidates(db: AliasDb, workIds: string[]): Promise<AnimeCandidate[]> {
  const result = await db.execute(candidateStatement(workIds));
  return result.rows.map(readStoredCandidate);
}

/** The bangumi + point-count for `workIds`, via an IN-set + JOIN + GROUP BY. */
function candidateStatement(workIds: string[]): SQL {
  return statementBuilder()
    .select({
      id: bangumi.id, title: bangumi.title, titleCn: bangumi.titleCn,
      coverUrl: bangumi.coverUrl, airDate: bangumi.airDate,
      pointsCount: count(points.id).as("points_count"),
    })
    .from(bangumi)
    .leftJoin(points, eq(points.bangumiId, bangumi.id))
    .where(inArray(bangumi.id, workIds))
    .groupBy(bangumi.id, bangumi.title, bangumi.titleCn, bangumi.coverUrl, bangumi.airDate)
    .getSQL();
}

function readAliasWork(row: Record<string, unknown>): AliasWork {
  return { bangumi_id: requiredString(row, "bangumi_id"), priority: requiredNumber(row, "priority") };
}

/** Map a stored row to a candidate, deriving `year` and the point count. */
function readStoredCandidate(row: Record<string, unknown>): AnimeCandidate {
  return candidateFromRow(parsedRow(row), requiredNumber(row, "points_count"));
}

function parsedRow(row: Record<string, unknown>): CandidateFields {
  return {
    id: requiredString(row, "id"),
    title: requiredString(row, "title"),
    title_cn: nullableString(row, "title_cn"),
    cover_url: nullableString(row, "cover_url"),
    air_date: nullableString(row, "air_date"),
  };
}
