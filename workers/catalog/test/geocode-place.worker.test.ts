import { describe, expect, it, vi } from "vitest";
import {
  geocodePlace,
  geocodeObservability,
  type ExternalGeocoderPort,
  type GazetteerPort,
} from "../src/application/geocode-place";
import { normalizeAlias } from "../src/lib/alias";
import type { GeocodeHit } from "../src/domain/geocode/collapse";
import type { GeocodeCandidate } from "../src/types";

/**
 * Tests at the published application seam: `geocodePlace` receives gazetteer
 * and external-geocoder results through fake ports — no SQL, no fetch on this
 * side. Proves exact-before-fuzzy sequencing, typed outcomes (exact, fuzzy,
 * ambiguity, no-result, timeout, invalid row), and redacted observability.
 */

function hit(overrides: Partial<GeocodeHit>): GeocodeHit {
  return {
    id: "seed:nishinomiya-station",
    name: "西宮駅",
    kind: "station",
    latitude: 34.7386,
    longitude: 135.3485,
    source: "manual",
    pref: "兵庫県",
    priority: 100,
    exact: true,
    ...overrides,
  };
}

function fakeGazetteer(exact: GeocodeHit[], fuzzy: GeocodeHit[] = []): GazetteerPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    exact: vi.fn((normalized: string) => {
      calls.push(`exact:${normalized}`);
      return Promise.resolve(exact);
    }),
    fuzzy: vi.fn((normalized: string) => {
      calls.push(`fuzzy:${normalized}`);
      return Promise.resolve(fuzzy);
    }),
  };
}

function fakeExternal(candidates: GeocodeCandidate[] | (() => Promise<GeocodeCandidate[]>)): ExternalGeocoderPort & { geocode: ReturnType<typeof vi.fn> } {
  const geocode = vi.fn(() => {
    const run = typeof candidates === "function" ? candidates : () => Promise.resolve(candidates);
    return run();
  });
  return { geocode };
}

const CANDIDATE = (id: string, name: string): GeocodeCandidate => ({
  id, label: name, name, lat: 34.7386, lng: 135.3485, kind: "station", source: "manual",
});

describe("geocodePlace — gazetteer tiers", () => {
  it("exact gazetteer hit resolves without touching fuzzy or external", async () => {
    const gazetteer = fakeGazetteer([hit({})]);
    const external = fakeExternal([]);

    const result = await geocodePlace({ gazetteer, external }, { query: "西宮", limit: 5 });

    expect(result.outcome).toBe("resolved");
    expect(result.sourceClass).toBe("gazetteer-exact");
    expect(result.candidates[0]).toMatchObject({
      id: "seed:nishinomiya-station", name: "西宮駅", kind: "station",
      source: "manual", effective_radius_m: 5_000,
    });
    expect(gazetteer.calls).toEqual(["exact:西宮"]);
    expect(external.geocode).not.toHaveBeenCalled();
  });

  it("passes the normalized alias to the gazetteer port", async () => {
    const gazetteer = fakeGazetteer([hit({})]);
    const external = fakeExternal([]);

    await geocodePlace({ gazetteer, external }, { query: "西宫", limit: 5 });

    expect(gazetteer.calls[0]).toBe(`exact:${normalizeAlias("西宫")}`);
  });

  it("runs fuzzy only after an exact miss, and never the external port", async () => {
    const fuzzyHit = hit({ id: "mlit:nishinomiya-kitaguchi", name: "西宮北口駅", exact: false });
    const gazetteer = fakeGazetteer([], [fuzzyHit]);
    const external = fakeExternal([]);

    const result = await geocodePlace({ gazetteer, external }, { query: "西宮北口", limit: 5 });

    expect(result.outcome).toBe("resolved");
    expect(result.sourceClass).toBe("gazetteer-fuzzy");
    expect(result.candidates[0]).toMatchObject({ id: "mlit:nishinomiya-kitaguchi" });
    expect(gazetteer.calls).toEqual(["exact:西宮北口", "fuzzy:西宮北口"]);
    expect(external.geocode).not.toHaveBeenCalled();
  });
});

describe("geocodePlace — gazetteer collapse", () => {
  it("collapses nearby same-name hits and reports ambiguity for distant ones", async () => {
    const near = hit({ id: "a", longitude: 135.3485 });
    const far = hit({ id: "b", name: "西宮市", kind: "city", longitude: 133.0, latitude: 33.0 });
    const gazetteer = fakeGazetteer([near, far]);
    const external = fakeExternal([]);

    const result = await geocodePlace({ gazetteer, external }, { query: "西宮", limit: 5 });

    expect(result.candidates).toHaveLength(2);
    expect(result.outcome).toBe("ambiguous");
  });

  it("limits collapsed candidates to the requested limit", async () => {
    const gazetteer = fakeGazetteer([
      hit({ id: "a", longitude: 135.0 }),
      hit({ id: "b", longitude: 133.0, latitude: 33.0 }),
      hit({ id: "c", longitude: 131.0, latitude: 31.0 }),
    ]);
    const external = fakeExternal([]);

    const result = await geocodePlace({ gazetteer, external }, { query: "西宮", limit: 2 });

    expect(result.candidates).toHaveLength(2);
  });
});

describe("geocodePlace — invalid rows", () => {
  it("treats an all-invalid gazetteer row set as invalid_row and stops", async () => {
    const bad = hit({ latitude: Number.NaN });
    const gazetteer = fakeGazetteer([bad]);
    const external = fakeExternal([]);

    const result = await geocodePlace({ gazetteer, external }, { query: "西宮", limit: 5 });

    expect(result.outcome).toBe("invalid_row");
    expect(result.candidates).toEqual([]);
    expect(gazetteer.calls).toEqual(["exact:西宮"]);
    expect(external.geocode).not.toHaveBeenCalled();
  });

  it("drops invalid rows while keeping valid ones from the same tier", async () => {
    const bad = hit({ id: "bad", latitude: Number.NaN });
    const good = hit({ id: "good" });
    const gazetteer = fakeGazetteer([bad, good]);
    const external = fakeExternal([]);

    const result = await geocodePlace({ gazetteer, external }, { query: "西宮", limit: 5 });

    expect(result.outcome).toBe("resolved");
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["good"]);
  });
});

describe("geocodePlace — external fallback", () => {
  it("falls back to the external geocoder only after both gazetteer tiers miss", async () => {
    const gazetteer = fakeGazetteer([], []);
    const external = fakeExternal([CANDIDATE("ext:1", "西宮")]);

    const result = await geocodePlace({ gazetteer, external }, { query: "西宮外れ", limit: 5 });

    expect(result.outcome).toBe("resolved");
    expect(result.sourceClass).toBe("external");
    expect(external.geocode).toHaveBeenCalledTimes(1);
  });

  it("returns no_result when every tier comes back empty", async () => {
    const gazetteer = fakeGazetteer([], []);
    const external = fakeExternal([]);

    const result = await geocodePlace({ gazetteer, external }, { query: "不存在", limit: 5 });

    expect(result).toMatchObject({ outcome: "no_result", sourceClass: null, candidates: [] });
    expect(external.geocode).toHaveBeenCalledTimes(1);
  });

  it("surfaces an external geocoder timeout instead of swallowing it as no_result", async () => {
    const gazetteer = fakeGazetteer([], []);
    const external = fakeExternal(() => Promise.reject(new Error("external geocoder timed out")));

    const result = await geocodePlace({ gazetteer, external }, { query: "西宮", limit: 5 });

    expect(result.outcome).toBe("timeout");
    expect(result.sourceClass).toBe("external");
    expect(result.candidates).toEqual([]);
  });
});

describe("geocodePlace — observability", () => {
  it("records redacted observability without place text", async () => {
    const gazetteer = fakeGazetteer([hit({})]);
    const external = fakeExternal([]);

    const result = await geocodePlace({ gazetteer, external }, { query: "西宮", limit: 5 });

    const record = geocodeObservability(result);
    const { duration_ms, ...rest } = record;
    expect(rest).toEqual({
      source_class: "gazetteer-exact",
      outcome: "resolved",
      candidate_count: 1,
    });
    expect(duration_ms).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(record)).not.toContain("西宮");
  });
});
