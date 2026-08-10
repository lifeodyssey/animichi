import type { ExternalGeocoderPort } from "../../application/geocode-place";

/**
 * External geocoder port adapter for deployments without a geocoding
 * provider: always returns no candidates, so the gazetteer remains the sole
 * resolution source. The port seam stays live for a fetch-backed client to
 * slot in once a provider is configured.
 */
export function unconfiguredGeocoder(): ExternalGeocoderPort {
  return { geocode: () => Promise.resolve([]) };
}
