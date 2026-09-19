/**
 * Outbound adapter for the `PointsByBangumiPort`: ONE SELECT that reads a
 * Bangumi's published points (joined to bangumi for the anime title) in scene
 * order. This adapter owns the only SQL and the row shape on the
 * points-by-bangumi read path.
 *
 * The SELECT is built with the shared contract's statement builder and run on
 * the request's runtime ({@link CatalogPrisma}), so the dialect parameterises
 * the `bangumi_id` bound and the ORDER BY defines "scene order".
 *
 * The join is `outerLeftJoin` — points without a bangumi row keep their point
 * and read a NULL title, which is what the Drizzle `leftJoin` did. The row
 * type is the plan's own projection: `points` is the left side so its
 * coordinates and name arrive non-null, while every `bangumi` column is
 * nullable because the left join can miss. Nothing narrows a raw row here, so
 * the `Catalog row … is not …` coercions the Drizzle path carried are gone
 * rather than ported (§4.2).
 */

import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { PointsByBangumiPort, PublishedPointRow } from "../../application/list-points-for-bangumi";
import type { CatalogPrisma } from "../../db/prisma";

/** Build the `PointsByBangumiPort` on one request's Prisma runtime (one SELECT, no writes). */
export function bangumiPoints(query: CatalogPrisma): PointsByBangumiPort {
  return { pointsForBangumi: (bangumiId) => selectPoints(query, bangumiId) };
}

/** SELECT the Bangumi's points joined to its title metadata, in scene order. */
async function selectPoints(query: CatalogPrisma, bangumiId: string): Promise<PublishedPointRow[]> {
  const rows = await query.executor.query(pointsForBangumiPlan(query, bangumiId));
  return [...rows];
}

/** The joined points+bangumi SELECT, ordered episode → time_seconds → id. */
function pointsForBangumiPlan(query: CatalogPrisma, bangumiId: string): SqlOrmPlan<PublishedPointRow> {
  return query.builder.public.points
    .outerLeftJoin(query.builder.public.bangumi, (fields, match) =>
      match.eq(fields.points.bangumi_id, fields.bangumi.id))
    .select((fields) => ({
      id: fields.points.id,
      name: fields.points.name,
      name_cn: fields.points.name_cn,
      bangumi_id: fields.points.bangumi_id,
      episode: fields.points.episode,
      time_seconds: fields.points.time_seconds,
      image: fields.points.image,
      latitude: fields.points.latitude,
      longitude: fields.points.longitude,
      city: fields.points.city,
      origin: fields.points.origin,
      origin_url: fields.points.origin_url,
      title: fields.bangumi.title,
      title_cn: fields.bangumi.title_cn,
      cover_url: fields.bangumi.cover_url,
      synced_at: fields.bangumi.updated_at,
    }))
    .where((fields, match) => match.eq(fields.points.bangumi_id, bangumiId))
    .orderBy((fields) => fields.points.episode, { direction: "asc" })
    .orderBy((fields) => fields.points.time_seconds, { direction: "asc" })
    .orderBy((fields) => fields.points.id, { direction: "asc" })
    .build();
}
