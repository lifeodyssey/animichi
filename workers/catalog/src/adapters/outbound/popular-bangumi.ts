/**
 * Popular-bangumi read adapter — the only SQL on the popularity ranking path
 * (CATALOG-5 #946). Replaces the agent-side Supabase list_popular query.
 * Built with the Drizzle query builder + expression helpers over the single
 * CatalogDb seam.
 */
import { gt, sql, type SQL } from "drizzle-orm";
import { statementBuilder } from "../../db/client";
import { bangumi } from "../../db/schema";

/** One ranked work row. */
export interface PopularBangumiRow {
  id: string;
  title: string;
  title_cn: string | null;
  cover_url: string | null;
  city: string | null;
  points_count: number;
  rating: number | null;
}

/** The minimal DB capability this adapter needs. */
export interface PopularBangumiDb {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
}

export function popularBangumiDb(db: PopularBangumiDb): PopularBangumiReader {
  return {
    listPopular: (limit) => loadPopular(db, limit),
  };
}

export interface PopularBangumiReader {
  listPopular(limit: number): Promise<PopularBangumiRow[]>;
}

async function loadPopular(db: PopularBangumiDb, limit: number): Promise<PopularBangumiRow[]> {
  const result = await db.execute(popularStatement(limit));
  return result.rows.map(parseRow);
}

/** The ranking SELECT: works with points, best-rated first (nulls last). */
function popularStatement(limit: number): SQL {
  return statementBuilder()
    .select({
      id: bangumi.id, title: bangumi.title, titleCn: bangumi.titleCn,
      coverUrl: bangumi.coverUrl, city: bangumi.city,
      pointsCount: bangumi.pointsCount, rating: bangumi.rating,
    })
    .from(bangumi)
    .where(gt(bangumi.pointsCount, 0))
    .orderBy(sql`${bangumi.rating} DESC NULLS LAST`)
    .limit(limit)
    .getSQL();
}

function parseRow(row: unknown): PopularBangumiRow {
  const record = row as Record<string, unknown>;
  return {
    id: stringField(record.id),
    title: stringField(record.title),
    title_cn: nullableStringField(record.title_cn),
    cover_url: nullableStringField(record.cover_url),
    city: nullableStringField(record.city),
    points_count: Number(record.points_count),
    rating: nullableNumberField(record.rating),
  };
}

const stringField = (value: unknown) => (typeof value === "string" ? value : "");
const nullableStringField = (value: unknown) => (typeof value === "string" ? value : null);
const nullableNumberField = (value: unknown) => (typeof value === "number" ? value : null);
