import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import {
  collapseGeocodeHits,
  FUZZY_RESULT_LIMIT,
  FUZZY_SIMILARITY_THRESHOLD,
  type GeocodeHit,
} from "../lib/geocode";
import { normalizeAlias } from "../lib/alias";
import type { GeocodeInput, GeocodeResult } from "../types";

async function exactHits(db: CatalogDb, normalized: string): Promise<GeocodeHit[]> {
  const result = await db.execute(sql`
    SELECT l.id, l.name, l.kind, l.latitude, l.longitude, l.source, l.pref,
           a.priority, TRUE AS exact
    FROM location_aliases a
    JOIN locations l ON l.id = a.location_id
    WHERE a.alias_normalized = ${normalized}
  `);
  return result.rows as unknown as GeocodeHit[];
}

async function fuzzyHits(db: CatalogDb, normalized: string): Promise<GeocodeHit[]> {
  const result = await db.execute(sql`
    SELECT id, name, kind, latitude, longitude, source, pref, priority, FALSE AS exact
    FROM (
      SELECT DISTINCT ON (l.id)
             l.id, l.name, l.kind, l.latitude, l.longitude, l.source, l.pref,
             a.priority, similarity(a.alias_normalized, ${normalized}) AS sim
      FROM location_aliases a
      JOIN locations l ON l.id = a.location_id
      WHERE a.alias_normalized % ${normalized}
        AND similarity(a.alias_normalized, ${normalized}) > ${FUZZY_SIMILARITY_THRESHOLD}
      ORDER BY l.id, similarity(a.alias_normalized, ${normalized}) DESC, a.priority DESC
    ) ranked
    ORDER BY sim DESC, priority DESC, id ASC
    LIMIT ${FUZZY_RESULT_LIMIT}
  `);
  return result.rows as unknown as GeocodeHit[];
}

async function lookupHits(db: CatalogDb, normalized: string): Promise<GeocodeHit[]> {
  const exact = await exactHits(db, normalized);
  return exact.length > 0 ? exact : fuzzyHits(db, normalized);
}

/** Resolve against the local gazetteer, falling back to trigrams on exact miss. */
export async function geocode(db: CatalogDb, input: GeocodeInput): Promise<GeocodeResult> {
  const hits = await lookupHits(db, normalizeAlias(input.query));
  const candidates = collapseGeocodeHits(hits, input.limit);
  return { candidates };
}
