/**
 * Popular-bangumi read adapter — the only SQL on the popularity ranking path
 * (CATALOG-5 #946). Replaces the agent-side Supabase list_popular query.
 */

import { sql } from "drizzle-orm";

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
  const result = await db.execute(sql`
    SELECT id, title, title_cn, cover_url, city, points_count, rating
    FROM bangumi
    WHERE points_count > 0
    ORDER BY rating DESC NULLS LAST
    LIMIT ${limit}
  `);
  return result.rows.map(parseRow);
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

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableStringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumberField(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
