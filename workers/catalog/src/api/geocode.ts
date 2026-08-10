import type { CatalogDb } from "../db/client";
import { geocodePlace } from "../application/geocode-place";
import { NeonGazetteer } from "../adapters/outbound/neon/gazetteer";
import { unconfiguredGeocoder } from "../adapters/outbound/geocoder-client";
import type { GeocodeInput, GeocodeResult } from "../types";

/** Resolve a place through the gazetteer, then the external geocoder. */
export async function geocode(db: CatalogDb, input: GeocodeInput): Promise<GeocodeResult> {
  const result = await geocodePlace(
    { gazetteer: new NeonGazetteer(db), external: unconfiguredGeocoder() },
    input,
  );
  return { candidates: result.candidates };
}
