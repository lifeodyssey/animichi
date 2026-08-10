import { describe, expect, it, vi } from "vitest";
import { unconfiguredGeocoder } from "../src/adapters/outbound/geocoder-client";
import { geocodePlace } from "../src/application/geocode-place";
import type { GeocodeHit } from "../src/domain/geocode/collapse";
import type { GeocodeCandidate } from "../src/types";

const CANDIDATE: GeocodeCandidate = {
  id: "ext:1",
  label: "西宮",
  name: "西宮",
  lat: 34.7386,
  lng: 135.3485,
  kind: "station",
  source: "manual",
};

describe("catalog geocoder client — unconfigured adapter", () => {
  it("exposes an external geocoder port", () => {
    expect(typeof unconfiguredGeocoder().geocode).toBe("function");
  });

  it("resolves to no candidates for any query", async () => {
    await expect(unconfiguredGeocoder().geocode("西宮")).resolves.toEqual([]);
  });
});

describe("geocodePlace — external tier outcome edge", () => {
  it("reports no_result when a zero limit empties a non-empty external result", async () => {
    const gazetteer = {
      exact: vi.fn(() => Promise.resolve<GeocodeHit[]>([])),
      fuzzy: vi.fn(() => Promise.resolve<GeocodeHit[]>([])),
    };
    const external = { geocode: vi.fn(() => Promise.resolve([CANDIDATE])) };

    const result = await geocodePlace({ gazetteer, external }, { query: "西宮", limit: 0 });

    expect(result).toMatchObject({ outcome: "no_result", sourceClass: "external", candidates: [] });
  });
});
