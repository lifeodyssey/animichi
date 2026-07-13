import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { collapseGeocodeHits, type GeocodeHit } from "../lib/geocode";
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

/** Resolve only against the local gazetteer; an exact miss returns empty in PR-A. */
export async function geocode(db: CatalogDb, input: GeocodeInput): Promise<GeocodeResult> {
  const hits = await exactHits(db, normalizeAlias(input.query));
  const candidates = collapseGeocodeHits(hits, input.limit);
  return { candidates };
}
