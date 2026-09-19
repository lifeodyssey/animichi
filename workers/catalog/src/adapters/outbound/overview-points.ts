/**
 * Overview read adapter — the only SQL on the overview projection path
 * (CATALOG-5 #946; moved onto the Prisma data plane by #1629). Replaces the
 * api/anime-overview.ts raw row projection.
 *
 * Both reads are built with the shared contract's statement builder and run on
 * the request's runtime ({@link CatalogPrisma}). Ordering (`points.id ASC`) is
 * part of the statement, so the use case's id-order assumptions hold without a
 * client-side sort.
 *
 * The row type is the plan's own projection, so the `stringField` /
 * `nullableStringField` pair the Drizzle path used to rebuild a typed shape
 * from an untyped row is gone rather than ported (§4.2) — a `float8` column
 * arrives as a number and a `text` column as a string, by contract.
 */

import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { OverviewPointRow, OverviewPointsReader } from "../../application/get-bangumi-overview";
import type { CatalogPrisma } from "../../db/prisma";

/** Build the `OverviewPointsReader` on one request's Prisma runtime (two SELECTs, no writes). */
export function overviewPointsDb(query: CatalogPrisma): OverviewPointsReader {
  return {
    pointsForWork: (bangumiId) => loadPoints(query, bangumiId),
    workExists: (bangumiId) => loadWorkExists(query, bangumiId),
  };
}

async function loadPoints(query: CatalogPrisma, bangumiId: string): Promise<OverviewPointRow[]> {
  const rows = await query.executor.query(pointsForWorkPlan(query, bangumiId));
  return [...rows];
}

/** The work's points in stable id order. */
function pointsForWorkPlan(query: CatalogPrisma, bangumiId: string): SqlOrmPlan<OverviewPointRow> {
  return query.builder.public.points
    .select("id", "name", "image", "latitude", "longitude", "city", "origin", "origin_url")
    .where((fields, match) => match.eq(fields.bangumi_id, bangumiId))
    .orderBy((fields) => fields.id, { direction: "asc" })
    .build();
}

async function loadWorkExists(query: CatalogPrisma, bangumiId: string): Promise<boolean> {
  const rows = await query.executor.query(workExistsPlan(query, bangumiId));
  return rows.length > 0;
}

/** Existence probe on the bangumi row (one row is enough). */
function workExistsPlan(query: CatalogPrisma, bangumiId: string): SqlOrmPlan<{ id: string }> {
  return query.builder.public.bangumi
    .select("id")
    .where((fields, match) => match.eq(fields.id, bangumiId))
    .limit(1)
    .build();
}
