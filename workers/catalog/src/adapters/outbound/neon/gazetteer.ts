/**
 * Gazetteer tier backed by the `location_aliases` / `locations` tables, on the
 * Prisma data plane (#1629).
 *
 * Both tiers are built with the shared contract's statement builder and run on
 * the request's runtime ({@link CatalogPrisma}). The Drizzle version read
 * `result.rows as unknown as GeocodeHit[]` — a double cast over a shape the
 * driver had already discarded. The plan now projects each tier's row, so the
 * cast is gone rather than ported (§4.2).
 *
 * Two things the contract cannot type, and how they are handled instead of
 * smuggled through a cast:
 *
 *   - `locations.kind` / `locations.source` are `text` columns whose legal sets
 *     live in CHECK constraints, not in the contract (its only value set is
 *     `RecordKind`). {@link placeKind} / {@link placeSource} decode them
 *     explicitly and fail loudly on a value the database should not hold.
 *   - The fuzzy tier's per-location pick: `priority` belongs to the alias that
 *     scored the location's BEST similarity (ties to the higher priority),
 *     which is what the Drizzle `DISTINCT ON (locations.id) … ORDER BY
 *     locations.id, similarity DESC, priority DESC` selected. The aggregate
 *     below states exactly that, so the rows, the ordering and the reported
 *     `priority` are unchanged.
 *
 * The trigram predicate is untouched, so `idx_location_aliases_trgm` still
 * serves `alias_normalized % $1`; `FUZZY_SIMILARITY_THRESHOLD` and
 * `FUZZY_RESULT_LIMIT` stay database-side constraints.
 */

import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { GazetteerPort } from "../../../application/geocode-place";
import {
  FUZZY_RESULT_LIMIT,
  FUZZY_SIMILARITY_THRESHOLD,
  type GeocodeHit,
} from "../../../domain/geocode/collapse";
import type { GeocodeKind, GeocodeSource } from "../../../types";
import type { CatalogPrisma } from "../../../db/prisma";

/** The place columns both tiers project. */
interface PlaceColumns {
  id: string;
  name: string;
  kind: string;
  latitude: number;
  longitude: number;
  source: string;
  pref: string | null;
}

/** One exact-tier row: the place plus the alias priority it matched on. */
interface ExactAliasRow extends PlaceColumns {
  priority: number;
}

/** One fuzzy-tier row: the place, its best-similarity alias priority, and that similarity. */
interface FuzzyAliasRow extends PlaceColumns {
  priority: number;
  sim: number;
}

const KIND_VALUES = ["station", "city", "ward", "landmark", "prefecture"] as const;
const SOURCE_VALUES = ["seed", "mlit", "geonames", "manual"] as const;

/** Gazetteer tier backed by the `location_aliases` / `locations` tables. */
export class NeonGazetteer implements GazetteerPort {
  constructor(private readonly query: CatalogPrisma) {}

  async exact(normalized: string): Promise<GeocodeHit[]> {
    const rows = await this.query.executor.query(exactPlan(this.query, normalized));
    return rows.map(toHit(true));
  }

  async fuzzy(normalized: string): Promise<GeocodeHit[]> {
    const rows = await this.query.executor.query(fuzzyPlan(this.query, normalized));
    return rows.map(toHit(false));
  }
}

/** Map a projected row to a hit, flagging the tier it came from. */
function toHit(exact: boolean): (row: ExactAliasRow | FuzzyAliasRow) => GeocodeHit {
  return (row) => ({ ...placeFields(row), exact });
}

/** The `GeocodeHit` fields a place row determines. */
function placeFields(row: ExactAliasRow | FuzzyAliasRow): Omit<GeocodeHit, "exact"> {
  return {
    id: row.id,
    name: row.name,
    kind: placeKind(row.kind),
    latitude: row.latitude,
    longitude: row.longitude,
    source: placeSource(row.source),
    pref: row.pref,
    priority: row.priority,
  };
}

/** Decode `locations.kind`'s CHECK-constrained set; throw on an impossible value. */
function placeKind(value: string): GeocodeKind {
  const kind = KIND_VALUES.find((candidate) => candidate === value);
  if (kind === undefined) throw new Error("gazetteer row kind is not a known place kind");
  return kind;
}

/** Decode `locations.source`'s CHECK-constrained set; throw on an impossible value. */
function placeSource(value: string): GeocodeSource {
  const source = SOURCE_VALUES.find((candidate) => candidate === value);
  if (source === undefined) throw new Error("gazetteer row source is not a known place source");
  return source;
}

/** Exact alias match: the location joined to its matching normalized alias. */
function exactPlan(query: CatalogPrisma, normalized: string): SqlOrmPlan<ExactAliasRow> {
  return query.builder.public.location_aliases
    .innerJoin(query.builder.public.locations, (fields, match) =>
      match.eq(fields.locations.id, fields.location_aliases.location_id))
    .select((fields) => ({
      id: fields.locations.id,
      name: fields.locations.name,
      kind: fields.locations.kind,
      latitude: fields.locations.latitude,
      longitude: fields.locations.longitude,
      source: fields.locations.source,
      pref: fields.locations.pref,
      priority: fields.location_aliases.priority,
    }))
    .where((fields, match) => match.eq(fields.location_aliases.alias_normalized, normalized))
    .build();
}

/**
 * Fuzzy pg_trgm fallback: ONE row per location — the alias that scored it
 * highest, ties to the higher priority — ranked by that similarity and capped.
 *
 * The Drizzle version reached the same rows with an inner `DISTINCT ON` and an
 * outer `ORDER BY sim DESC LIMIT n`. This builder has no derived-table root, so
 * the same question is asked as a grouped read: the per-location pick is stated
 * in the projection and the ranking reads the grouped alias.
 */
function fuzzyPlan(query: CatalogPrisma, normalized: string): SqlOrmPlan<FuzzyAliasRow> {
  return query.builder.public.location_aliases
    .innerJoin(query.builder.public.locations, (fields, match) =>
      match.eq(fields.locations.id, fields.location_aliases.location_id))
    .select((fields) => ({
      id: fields.locations.id,
      name: fields.locations.name,
      kind: fields.locations.kind,
      latitude: fields.locations.latitude,
      longitude: fields.locations.longitude,
      source: fields.locations.source,
      pref: fields.locations.pref,
    }))
    .select("priority", (fields, fns) =>
      fns.raw`(array_agg(${fields.location_aliases.priority} order by similarity(${fields.location_aliases.alias_normalized}, ${normalized}) desc, ${fields.location_aliases.priority} desc))[1]`
        .returns("pg/int4@1"))
    .select("sim", (fields, fns) =>
      fns.raw`max(similarity(${fields.location_aliases.alias_normalized}, ${normalized}))`
        .returns("pg/float4@1"))
    .where((fields, fns) => fns.and(
      fns.raw`${fields.location_aliases.alias_normalized} % ${normalized}`.returns("pg/bool@1"),
      fns.gt(
        fns.raw`similarity(${fields.location_aliases.alias_normalized}, ${normalized})`.returns("pg/float4@1"),
        FUZZY_SIMILARITY_THRESHOLD,
      ),
    ))
    .groupBy("id", "name", "kind", "latitude", "longitude", "source", "pref")
    .orderBy("sim", { direction: "desc" })
    .limit(FUZZY_RESULT_LIMIT)
    .build();
}
