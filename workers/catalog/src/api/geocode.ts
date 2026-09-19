import { geocodePlace } from "../application/geocode-place";
import { NeonGazetteer } from "../adapters/outbound/neon/gazetteer";
import { unconfiguredGeocoder } from "../adapters/outbound/geocoder-client";
import type { CatalogPrisma } from "../db/prisma";
import type { GeocodeInput, GeocodeResult } from "../types";

/**
 * Resolve a place through the gazetteer, then the external geocoder.
 *
 * The gazetteer tiers build their plans with the shared contract's builder and
 * run them on the caller's request runtime ({@link CatalogPrisma}, #1631/spec
 * §4.2), so the dialect binds the trigram predicate and the row shape is the
 * plan's own projection. The external tier is a fetch, not a read.
 */
export async function geocode(query: CatalogPrisma, input: GeocodeInput): Promise<GeocodeResult> {
  const result = await geocodePlace(
    { gazetteer: new NeonGazetteer(query), external: unconfiguredGeocoder() },
    input,
  );
  return { candidates: result.candidates };
}
