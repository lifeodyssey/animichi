import { and, desc, eq, gt, sql, type SQL } from "drizzle-orm";
import type { CatalogDb } from "../../../db/client";
import { statementBuilder } from "../../../db/client";
import type { GazetteerPort } from "../../../application/geocode-place";
import {
  FUZZY_RESULT_LIMIT,
  FUZZY_SIMILARITY_THRESHOLD,
  type GeocodeHit,
} from "../../../domain/geocode/collapse";
import { locationAliases, locations } from "../../../db/schema";
import * as x from "../../../db/expressions";

/** Gazetteer tier backed by the `location_aliases` / `locations` tables. */
export class NeonGazetteer implements GazetteerPort {
  constructor(private readonly db: CatalogDb) {}

  async exact(normalized: string): Promise<GeocodeHit[]> {
    const result = await this.db.execute(exactStatement(normalized));
    return result.rows as unknown as GeocodeHit[];
  }

  async fuzzy(normalized: string): Promise<GeocodeHit[]> {
    const result = await this.db.execute(fuzzyStatement(normalized));
    return result.rows as unknown as GeocodeHit[];
  }
}

/** Exact alias match: the location joined to its highest-priority normalized alias. */
function exactStatement(normalized: string): SQL {
  return statementBuilder()
    .select({
      id: locations.id, name: locations.name, kind: locations.kind,
      latitude: locations.latitude, longitude: locations.longitude,
      source: locations.source, pref: locations.pref,
      priority: locationAliases.priority, exact: sql`TRUE`.as("exact"),
    })
    .from(locationAliases)
    .innerJoin(locations, eq(locations.id, locationAliases.locationId))
    .where(eq(locationAliases.aliasNormalized, normalized))
    .getSQL();
}

/** Fuzzy pg_trgm fallback: DISTINCT ON the location, ranked by similarity. */
function fuzzyStatement(normalized: string): SQL {
  const sim = x.trigramSimilarity(locationAliases.aliasNormalized, normalized).as("sim");
  const ranked = statementBuilder()
    .selectDistinctOn(
      [locations.id],
      {
        id: locations.id, name: locations.name, kind: locations.kind,
        latitude: locations.latitude, longitude: locations.longitude,
        source: locations.source, pref: locations.pref, priority: locationAliases.priority,
        sim,
      },
    )
    .from(locationAliases)
    .innerJoin(locations, eq(locations.id, locationAliases.locationId))
    .where(
      and(
        x.trigramMatches(locationAliases.aliasNormalized, normalized),
        gt(x.trigramSimilarity(locationAliases.aliasNormalized, normalized), FUZZY_SIMILARITY_THRESHOLD),
      ),
    )
    .orderBy(locations.id, desc(x.trigramSimilarity(locationAliases.aliasNormalized, normalized)), desc(locationAliases.priority))
    .as("ranked");
  return statementBuilder()
    .select({
      id: ranked.id, name: ranked.name, kind: ranked.kind,
      latitude: ranked.latitude, longitude: ranked.longitude,
      source: ranked.source, pref: ranked.pref, priority: ranked.priority,
      exact: sql`FALSE`.as("exact"),
    })
    .from(ranked)
    .orderBy(desc(ranked.sim))
    .limit(FUZZY_RESULT_LIMIT)
    .getSQL();
}
