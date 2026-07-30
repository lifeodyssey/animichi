import type { PilgrimagePoint, SearchResult } from "@animichi/contract";

/** Base origin the unit MSW swimlane serves; matches the jsdom `location.origin`. */
export const TEST_ORIGIN = "http://localhost:3000";

export const CATALOG_SEARCH_URL = `${TEST_ORIGIN}/catalog/search`;

const hakoneStation = {
  id: "point-1",
  name: "Hakone-Yumoto Station",
  bangumi_id: "12345",
  screenshot_url: "https://cdn.test/point-1.jpg",
  latitude: 35.2323,
  longitude: 139.1069,
} satisfies PilgrimagePoint;

/** A valid, contract-shaped catalog search payload. */
export const searchSuccessFixture = {
  rows: [hakoneStation],
  synced_at: "2026-07-18T00:00:00.000Z",
} satisfies SearchResult;
