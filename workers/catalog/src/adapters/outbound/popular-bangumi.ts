/**
 * Popular-bangumi read adapter — the only SQL on the popularity ranking path
 * (CATALOG-5 #946; moved onto the Prisma data plane by #1629). Replaces the
 * agent-side Supabase list_popular query.
 *
 * The ranking is built with the shared contract's statement builder and run on
 * the request's runtime ({@link CatalogPrisma}), so the projection, the filter
 * and the `NULLS LAST` ordering are declared once and the dialect binds them.
 *
 * The row type is the plan's own projection — nothing re-reads a raw row here,
 * so the `Catalog row … is not numeric` coercions the Drizzle path carried are
 * gone rather than ported (§4.2). Two columns need a decision rather than a
 * port, and both are taken in the projection where they belong:
 *
 *   - `points_count` is nullable in the contract and REQUIRED by the published
 *     `PopularBangumi` shape (`packages/contract`), so the read coalesces it:
 *     absent means zero, which is what the deleted `Number(null)` coercion
 *     silently produced.
 *   - `rating` stays nullable — the ranking's "nulls last" is its contract. The
 *     builder's `orderBy(…, { nulls: 'last' })` is DECLARED but not implemented
 *     (`resolveOrderBy` reads only `direction`, and no `NULLS` is emitted
 *     anywhere in `@prisma/orm-family-sql`), and Postgres defaults a `DESC`
 *     order to NULLS FIRST — so the nulls-last key is stated explicitly as a
 *     leading `rating IS NULL` ascending sort. The emitted order is the same
 *     one `ORDER BY rating DESC NULLS LAST` produced.
 */

import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../../db/prisma";

/**
 * One ranked work row. An `interface`, not a type alias, on purpose: the plan
 * already hands back exactly this shape, and an interface keeps the deleted
 * row-narrowing helpers (`src/lib/rows.ts`) from being called on it again —
 * TypeScript refuses to pass one to their `Record<string, unknown>` parameter.
 */
export interface PopularBangumiRow {
  id: string;
  title: string;
  title_cn: string | null;
  cover_url: string | null;
  city: string | null;
  points_count: number;
  rating: number | null;
}

export interface PopularBangumiReader {
  listPopular(limit: number): Promise<PopularBangumiRow[]>;
}

/** Build the `PopularBangumiReader` on one request's Prisma runtime. */
export function popularBangumiDb(query: CatalogPrisma): PopularBangumiReader {
  return {
    listPopular: (limit) => loadPopular(query, limit),
  };
}

/** The capped ranking rows, in the order the ranking read returned them. */
async function loadPopular(query: CatalogPrisma, limit: number): Promise<PopularBangumiRow[]> {
  const rows = await query.executor.query(popularPlan(query, limit));
  return [...rows];
}

/** The ranking SELECT: works with points, best-rated first (nulls last). */
function popularPlan(query: CatalogPrisma, limit: number): SqlOrmPlan<PopularBangumiRow> {
  return query.builder.public.bangumi
    .select("id", "title", "title_cn", "cover_url", "city", "rating")
    .select("points_count", (fields, fns) =>
      fns.raw`coalesce(${fields.points_count}, 0)`.returns("pg/int4@1"))
    .where((fields, match) => match.gt(fields.points_count, 0))
    .orderBy((fields, fns) => fns.raw`${fields.rating} is null`.returns("pg/bool@1"))
    .orderBy((fields) => fields.rating, { direction: "desc" })
    .limit(limit)
    .build();
}
