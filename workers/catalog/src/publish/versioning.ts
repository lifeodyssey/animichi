/**
 * Atomic version publish over `cluster_version`
 * (the data-plane contract):
 *   id, bangumi_id, version, is_current, created_at, with the partial unique index
 *   `uq_cluster_version_one_current` (bangumi_id) WHERE is_current.
 *
 * A publish is a blue/green pointer switch done in ONE transaction: flip any
 * current row to is_current=false, THEN insert the new row with is_current=true.
 * The flip-then-insert order is mandatory — reversing it would momentarily leave
 * two current rows and violate the partial unique index. The transaction makes
 * the swap all-or-nothing, so a reader never sees zero or two current rows.
 *
 * Both statements are builder plans run on the request's runtime ({@link
 * CatalogPrisma}), so the dialect binds the work id and the projection fixes the
 * version's type. This is the call the deleted `db.batch` in `enrich` became: the
 * batch existed because neon-http had no client transaction, and a real
 * transaction orders the flip and the insert without a statement array.
 *
 * The next version is read between the two statements rather than derived by a
 * correlated subquery inside the INSERT — the Drizzle path computed
 * `COALESCE(MAX(version), 0) + 1` in the statement, and the builder has no
 * expression slot in an INSERT's values. Reading it there is equivalent for
 * every publish after the first, because the flip already holds the work's
 * current row until commit; the case it does not serialise, two FIRST publishes
 * racing on a work with no current row, is refused by the partial unique index
 * on both paths rather than silently absorbed.
 */
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";

interface VersionRow extends Record<string, unknown> {
  version: number;
}

/** Publish a new version for a work; returns the new version number. */
export async function publishVersion(query: CatalogPrisma, bangumiId: string): Promise<number> {
  await flipCurrentOff(query, bangumiId);
  return readPublishedVersion(await insertNext(query, bangumiId));
}

/** Flip the work's current row (if any) to is_current=false. */
async function flipCurrentOff(query: CatalogPrisma, bangumiId: string): Promise<void> {
  await query.executor.query(flipPlan(query, bangumiId));
}

/** The flip: the work's current row stops being current. */
export function flipPlan(query: CatalogPrisma, bangumiId: string): SqlOrmPlan {
  return query.builder.public.cluster_version
    .update({ is_current: false })
    .where((fields, match) => match.and(
      match.eq(fields.bangumi_id, bangumiId),
      match.eq(fields.is_current, true),
    ))
    .build();
}

/** Derive and insert the work's next version as the current row. */
async function insertNext(query: CatalogPrisma, bangumiId: string): Promise<readonly unknown[]> {
  const version = readNextVersion(await query.executor.query(nextVersionPlan(query, bangumiId)));
  return query.executor.query(insertVersionPlan(query, bangumiId, version));
}

/** The work's version rows, newest first, for the publish that follows. */
function insertVersionPlan(query: CatalogPrisma, bangumiId: string, version: number): SqlOrmPlan<VersionRow> {
  return query.builder.public.cluster_version
    .insert([{ bangumi_id: bangumiId, version, is_current: true }])
    .returning("version")
    .build();
}

/**
 * `COALESCE(MAX(version), 0) + 1` over the work's versions.
 *
 * The arithmetic is a raw fragment inside the builder's own projection — an
 * expression, never a statement — and `cluster_version.version` is the `int4`
 * the published shape already is, so the result decodes as a number with no cast.
 */
export function nextVersionPlan(query: CatalogPrisma, bangumiId: string): SqlOrmPlan<VersionRow> {
  return query.builder.public.cluster_version
    .select("version", (_fields, fns) => fns.raw`coalesce(max(version), 0) + 1`.returns("pg/int4@1"))
    .where((fields, match) => match.eq(fields.bangumi_id, bangumiId))
    .build();
}

/** The next version from a `nextVersionPlan` result; absent rows mean the first publish. */
function readNextVersion(rows: readonly unknown[]): number {
  const row = rows[0];
  if (typeof row !== "object" || row === null || !("version" in row)) return 1;
  return typeof row.version === "number" ? row.version : 1;
}

/** Read and validate the INSERT ... RETURNING version result. */
export function readPublishedVersion(result: readonly unknown[]): number {
  const row = result[0];
  if (typeof row !== "object" || row === null || !("version" in row)) {
    throw new Error("publish returned no version");
  }
  if (typeof row.version !== "number") throw new Error("publish returned an invalid version");
  return row.version;
}
