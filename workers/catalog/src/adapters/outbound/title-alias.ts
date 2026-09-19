/**
 * Outbound adapter for the `TitleAliasPort`: exact alias lookup plus stored
 * candidate enrichment over the alias index and `bangumi` rows. This adapter
 * owns the only SQL on the resolve path; resolution policy stays in the
 * application use case (`application/resolve-bangumi.ts`).
 *
 * Both statements are built with the shared contract's statement builder and
 * run on the request's runtime ({@link CatalogPrisma}).
 *
 * Neither read needs a hand-written aggregate: the contract declares no
 * aggregate operations, and the two questions here are both answerable with
 * first-class builder moves —
 *
 *   - "the highest-priority alias per work" is `DISTINCT ON (bangumi_id)` over
 *     `priority DESC`, which is what the deleted `MAX(priority) … GROUP BY`
 *     computed. `aliases.priority` is NOT NULL, so the two agree exactly.
 *   - "how many points a work has" is a grouped `count(points.id)` cast to
 *     `int4`, which stays a raw expression fragment inside the builder
 *     (`fns.raw`) — never a complete statement — and is 0 rather than NULL for
 *     a work with no points. The cast is not cosmetic: the raw lane decodes
 *     `count`'s `int8` as a STRING, while the contract's `int4` codec decodes a
 *     number, and the published `points_count` is the `int4` the `bangumi`
 *     column already is.
 */

import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import { candidateFromRow, type AliasWork, type CandidateFields, type TitleAliasPort } from "../../application/resolve-bangumi";
import type { AnimeCandidate } from "../../types";
import type { CatalogPrisma } from "../../db/prisma";

/**
 * One stored candidate row: the `bangumi` columns the candidate is built from,
 * plus its point count. An `interface`, not a type alias, on purpose — the plan
 * hands back exactly this shape, and an interface keeps the deleted row-narrowing
 * helpers (`src/lib/rows.ts`) from being called on it again.
 */
export interface StoredCandidateRow extends CandidateFields {
  points_count: number;
}

/** Build the `TitleAliasPort` on one request's Prisma runtime (two SELECTs, no writes). */
export function titleAlias(query: CatalogPrisma): TitleAliasPort {
  return {
    worksForAlias: (normalized) => selectAliasWorks(query, normalized),
    candidatesForWorks: (workIds) => selectCandidates(query, workIds),
  };
}

async function selectAliasWorks(query: CatalogPrisma, normalized: string): Promise<AliasWork[]> {
  const rows = await query.executor.query(aliasWorksPlan(query, normalized));
  return [...rows];
}

/** The highest-priority alias per work for a normalized alias. */
function aliasWorksPlan(query: CatalogPrisma, normalized: string): SqlOrmPlan<AliasWork> {
  return query.builder.public.aliases
    .select("bangumi_id", "priority")
    .where((fields, match) => match.eq(fields.alias_normalized, normalized))
    .distinctOn("bangumi_id")
    .orderBy("bangumi_id", { direction: "asc" })
    .orderBy("priority", { direction: "desc" })
    .build();
}

async function selectCandidates(query: CatalogPrisma, workIds: string[]): Promise<AnimeCandidate[]> {
  const rows = await query.executor.query(candidatePlan(query, workIds));
  return rows.map((row) => candidateFromRow(row, row.points_count));
}

/**
 * The bangumi + point-count for `workIds`, via an IN-set + JOIN + GROUP BY.
 *
 * Every key is spelled through its owning table: both sides of the join carry
 * `id`, so a bare `GROUP BY "id"` is `42702 ambiguous` — qualifying the
 * expression is the only unambiguous spelling.
 */
function candidatePlan(query: CatalogPrisma, workIds: string[]): SqlOrmPlan<StoredCandidateRow> {
  return query.builder.public.bangumi
    .outerLeftJoin(query.builder.public.points, (fields, match) =>
      match.eq(fields.points.bangumi_id, fields.bangumi.id))
    .select((fields) => ({
      id: fields.bangumi.id,
      title: fields.bangumi.title,
      title_cn: fields.bangumi.title_cn,
      cover_url: fields.bangumi.cover_url,
      air_date: fields.bangumi.air_date,
    }))
    .select("points_count", (fields, fns) =>
      fns.raw`count(${fields.points.id})::int4`.returns("pg/int4@1"))
    .where((fields, match) => match.in(fields.bangumi.id, workIds))
    .groupBy((fields) => fields.bangumi.id)
    .groupBy((fields) => fields.bangumi.title)
    .groupBy((fields) => fields.bangumi.title_cn)
    .groupBy((fields) => fields.bangumi.cover_url)
    .groupBy((fields) => fields.bangumi.air_date)
    .build();
}
