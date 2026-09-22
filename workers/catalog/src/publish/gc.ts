/**
 * Version garbage collection over `cluster_version`
 * (the data-plane contract).
 *
 * Keeps the newest `keep` versions for a work and deletes the rest. The current
 * row (is_current=true) is NEVER deleted, even if it falls outside the keep
 * window — the live pointer must always survive. Itinerary snapshots are not touched:
 * they are immutable and intentionally outlive their version (no-drift), so a GC'd
 * version's snapshot still reads back unchanged.
 *
 * The delete is a builder plan on the request's runtime ({@link CatalogPrisma}).
 * Its keep window — the newest `keep` versions, then `MIN(version)` over them —
 * is a derived subquery the builder does not model first-class, so it is
 * composed as a narrowly scoped fragment inside the DELETE's predicate. The work
 * id and the window size are interpolations, and an interpolation in a raw
 * fragment is a BOUND value, never rendered SQL text.
 */
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";

/** Delete non-current versions older than the newest `keep`; returns count deleted. */
export async function gcOldVersions(query: CatalogPrisma, bangumiId: string, keep: number): Promise<number> {
  if (keep < 1) throw new Error("keep must be >= 1");
  return (await query.executor.query(gcPlan(query, bangumiId, keep))).length;
}

/** The keep-window delete: the work's non-current versions below the window's floor. */
function gcPlan(query: CatalogPrisma, bangumiId: string, keep: number): SqlOrmPlan<{ id: string }> {
  return query.builder.public.cluster_version
    .delete()
    .where((fields, match) => match.and(
      match.eq(fields.bangumi_id, bangumiId),
      match.eq(fields.is_current, false),
      match.raw`${fields.version} < (select min(version) from (select version from cluster_version where bangumi_id = ${bangumiId} order by version desc limit ${keep}) as kept)`.returns("pg/bool@1"),
    ))
    .returning("id")
    .build();
}
