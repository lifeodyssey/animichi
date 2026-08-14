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

function assertNonNegative(seconds: number): void {
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new Error("interval seconds must be a non-negative integer");
  }
}
