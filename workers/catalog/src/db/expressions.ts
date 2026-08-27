/**
 * Typed PostgreSQL expression helpers (story 9, #992).
 *
 * These return Drizzle `SQL` *fragments* — parameterisation is flattened and
 * bound through the Drizzle dialect when the composed statement runs over the
 * single CatalogDb adapter seam (`db.execute` / `db.batch`). A helper:
 *
 *   - is narrowly scoped to one PostgreSQL capability Drizzle does not model
 *     first-class (PostGIS geometry, pg_trgm similarity, interval arithmetic);
 *   - NEVER contains a complete SELECT / INSERT / UPDATE / DELETE / DDL
 *     statement — it is always a building block composed with the query builder;
 *   - NEVER executes a query on its own.
 *
 * Complete hand-written SQL lives only here and in Atlas migrations.
 */
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

// --- PostGIS geography -----------------------------------------------------

/** Build a geograph(Point,4326) value from a lat/lng pair. */
export function geoPoint(latitude: number, longitude: number): SQL {
  return sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography`;
}

/** `ST_DWithin` predicate: is `column` within `meters` of `point`. */
export function withinMeters(column: PgColumn, point: SQL, meters: number): SQL {
  return sql`ST_DWithin(${column}, ${point}, ${meters})`;
}

/** `ST_Distance` in meters from `column` to `point` (for a SELECT/expose). */
export function distanceMeters(column: PgColumn, point: SQL): SQL {
  return sql`ST_Distance(${column}, ${point})`;
}

/** The PostGIS KNN operator (`<->`) used to ORDER BY proximity. */
export function knnDistance(column: PgColumn, point: SQL): SQL {
  return sql`${column} <-> ${point}`;
}

// --- pg_trgm ---------------------------------------------------------------

/** `similarity(a, b)` scalar for the stored trigram similarity. */
export function trigramSimilarity(lhs: PgColumn, rhs: string): SQL {
  return sql`similarity(${lhs}, ${rhs})`;
}

/** The pg_trgm `%` operator for candidate pre-filtering (no ordering). */
export function trigramMatches(lhs: PgColumn, rhs: string): SQL {
  return sql`${lhs} % ${rhs}`;
}

// --- time / interval -------------------------------------------------------

/** `make_interval(secs => n)` — a positive integer second count. */
export function intervalSeconds(seconds: number): SQL {
  assertNonNegative(seconds);
  return sql`make_interval(secs => ${seconds})`;
}

/** `NOW()` — the transaction/mutation timestamp. */
export function now(): SQL {
  return sql`NOW()`;
}

/** Yesterday-style bound: `cutoff` is strictly older than `seconds` ago. */
export function olderThanSeconds(column: PgColumn, seconds: number): SQL {
  return sql`${column} <= NOW() - ${intervalSeconds(seconds)}`;
}

/** `COALESCE(column, fallback)` — a nullable column resolved to a default. */
export function coalesce(column: PgColumn, fallback: unknown): SQL {
  return sql`COALESCE(${column}, ${fallback})`;
}

/** `column IS NOT NULL` — a predicate fragment for a nullable column. */
export function isNotNull(column: PgColumn): SQL {
  return sql`${column} IS NOT NULL`;
}

/**
 * Valid raw-source fetch aliases the crawl-stale builder subquery uses.
 * Static identifiers live here as a safe literal whitelist — never interpolated
 * caller input — so the raw-zone column references are baked in as template
 * text with no runtime raw-string interpolation.
 */
export const RAW_FETCH_ALIASES = { anitabi: "a", bangumi: "b" } as const;
export type RawFetchAlias = keyof typeof RAW_FETCH_ALIASES;

/** Raw-zone `fetched_at` column reference per alias (static SQL values). */
const FETCHED_AT_BY_ALIAS: Record<RawFetchAlias, SQL> = {
  anitabi: sql`a.fetched_at`,
  bangumi: sql`b.fetched_at`,
};

/**
 * A work's raw-zone freshness: the WEAKER of its two source fetches (a source
 * with no raw row reads as `-infinity`). Composed inside the crawl-stale builder
 * subquery; the raw-fetch aliases are drawn from the `RAW_FETCH_ALIASES` whitelist.
 */
export function weakestRawFreshness(aFetch: RawFetchAlias, bFetch: RawFetchAlias): SQL {
  const aFetchedAt = FETCHED_AT_BY_ALIAS[aFetch];
  const bFetchedAt = FETCHED_AT_BY_ALIAS[bFetch];
  return sql`LEAST(COALESCE(${aFetchedAt}, '-infinity'), COALESCE(${bFetchedAt}, '-infinity'))`;
}

/**
 * A row is stale when its heartbeat (the first non-null of `primary` /
 * `fallback`) has not beaten for at least `seconds`. The singleflight
 * acquire uses this to steal an abandoned running row.
 */
export function staleForSeconds(primary: PgColumn, fallback: PgColumn, seconds: number): SQL {
  return sql`COALESCE(${primary}, ${fallback}) <= NOW() - make_interval(secs => ${seconds})`;
}

/**
 * A row is live when its heartbeat is newer than `seconds` — the exact
 * negation of {@link staleForSeconds}. The guard's `running_live` projection
 * uses this: the old, ambiguously named single expression was pasted into
 * both sites with opposite questions, reporting a dead running row as
 * in_progress forever (issue #1227).
 */
export function heartbeatWithinSeconds(primary: PgColumn, fallback: PgColumn, seconds: number): SQL {
  return sql`COALESCE(${primary}, ${fallback}) > NOW() - make_interval(secs => ${seconds})`;
}
function assertNonNegative(seconds: number): void {
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new Error("interval seconds must be a non-negative integer");
  }
}
