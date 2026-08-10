import { sql } from "drizzle-orm";
import type { CatalogDb } from "../../../db/client";
import type { GazetteerPort } from "../../../application/geocode-place";
import {
  FUZZY_RESULT_LIMIT,
  FUZZY_SIMILARITY_THRESHOLD,
  type GeocodeHit,
} from "../../../domain/geocode/collapse";

/** Gazetteer tier backed by the `location_aliases` / `locations` tables. */
export class NeonGazetteer implements GazetteerPort {
  constructor(private readonly db: CatalogDb) {}

  async exact(normalized: string): Promise<GeocodeHit[]> {
    const result = await this.db.execute(sql`
      SELECT l.id, l.name, l.kind, l.latitude, l.longitude, l.source, l.pref,
             a.priority, TRUE AS exact
      FROM location_aliases a
      JOIN locations l ON l.id = a.location_id
      WHERE a.alias_normalized = ${normalized}
    `);
    return result.rows as unknown as GeocodeHit[];
  }

  async fuzzy(normalized: string): Promise<GeocodeHit[]> {
    const result = await this.db.execute(sql`
      SELECT id, name, kind, latitude, longitude, source, pref, priority, FALSE AS exact
      FROM (
        SELECT DISTINCT ON (l.id) l.id, l.name, l.kind, l.latitude, l.longitude,
               l.source, l.pref, a.priority, similarity(a.alias_normalized, ${normalized}) AS sim
        FROM location_aliases a JOIN locations l ON l.id = a.location_id
        WHERE a.alias_normalized % ${normalized}
          AND similarity(a.alias_normalized, ${normalized}) > ${FUZZY_SIMILARITY_THRESHOLD}
        ORDER BY l.id, similarity(a.alias_normalized, ${normalized}) DESC, a.priority DESC) ranked
      ORDER BY sim DESC, priority DESC, id ASC LIMIT ${FUZZY_RESULT_LIMIT}
    `);
    return result.rows as unknown as GeocodeHit[];
  }
}
