/**
 * `geocodePlace` application use case: resolve a place name exact-before-fuzzy
 * through the gazetteer, falling back to the external geocoder only when both
 * gazetteer tiers miss. Orchestration only — no SQL, no fetch here.
 *
 * Flow: `gazetteer.exact(normalized)` -> `gazetteer.fuzzy(normalized)` ->
 * `external.geocode(query)`; each gazetteer tier runs the pure 12km collapse
 * (`domain/geocode/collapse.ts`). Outcome classes: resolved, ambiguous
 * (more than one candidate), no_result, timeout (external rejection),
 * invalid_row (every gazetteer row has broken coordinates).
 */

import { normalizeAlias } from "../lib/alias";
import {
  collapseGeocodeHits,
  isValidGeocodeHit,
  type GeocodeHit,
} from "../domain/geocode/collapse";
import type { GeocodeCandidate, GeocodeInput } from "../types";

export interface GazetteerPort {
  exact(normalized: string): Promise<GeocodeHit[]>;
  fuzzy(normalized: string): Promise<GeocodeHit[]>;
}

export interface ExternalGeocoderPort {
  geocode(query: string): Promise<GeocodeCandidate[]>;
}

export type GeocodeOutcome = "resolved" | "ambiguous" | "no_result" | "timeout" | "invalid_row";
export type GeocodeSourceClass = "gazetteer-exact" | "gazetteer-fuzzy" | "external" | null;

export interface GeocodePlaceResult {
  outcome: GeocodeOutcome;
  sourceClass: GeocodeSourceClass;
  candidates: GeocodeCandidate[];
  durationMs: number;
}

interface GeocodePlaceOutcome {
  outcome: GeocodeOutcome;
  sourceClass: GeocodeSourceClass;
  candidates: GeocodeCandidate[];
}

/** Resolve `input.query` exact-before-fuzzy, recording the elapsed duration. */
export async function geocodePlace(deps: GeocodeDeps, input: GeocodeInput): Promise<GeocodePlaceResult> {
  const startedAt = Date.now();
  const outcome = await resolvePlace(deps, input);
  return { ...outcome, durationMs: Date.now() - startedAt };
}

/** Redacted observability record: source class, outcome, count, duration. */
export function geocodeObservability(result: GeocodePlaceResult): GeocodeObservabilityRecord {
  return {
    source_class: result.sourceClass,
    outcome: result.outcome,
    candidate_count: result.candidates.length,
    duration_ms: result.durationMs,
  };
}

export interface GeocodeDeps {
  gazetteer: GazetteerPort;
  external: ExternalGeocoderPort;
}

export interface GeocodeObservabilityRecord {
  source_class: GeocodeSourceClass;
  outcome: GeocodeOutcome;
  candidate_count: number;
  duration_ms: number;
}

async function resolvePlace(deps: GeocodeDeps, input: GeocodeInput): Promise<GeocodePlaceOutcome> {
  const normalized = normalizeAlias(input.query);
  const exact = await deps.gazetteer.exact(normalized);
  if (exact.length > 0) return collapseTier(exact, "gazetteer-exact", input.limit);
  const fuzzy = await deps.gazetteer.fuzzy(normalized);
  if (fuzzy.length > 0) return collapseTier(fuzzy, "gazetteer-fuzzy", input.limit);
  return externalTier(deps.external, input);
}

function collapseTier(hits: GeocodeHit[], sourceClass: GeocodeSourceClass, limit: number): GeocodePlaceOutcome {
  const valid = hits.filter(isValidGeocodeHit);
  if (valid.length === 0) return { outcome: "invalid_row", sourceClass, candidates: [] };
  const candidates = collapseGeocodeHits(valid, limit);
  return { outcome: outcomeOf(candidates), sourceClass, candidates };
}

function outcomeOf(candidates: GeocodeCandidate[]): GeocodeOutcome {
  if (candidates.length === 0) return "no_result";
  return candidates.length === 1 ? "resolved" : "ambiguous";
}

async function externalTier(external: ExternalGeocoderPort, input: GeocodeInput): Promise<GeocodePlaceOutcome> {
  let candidates: GeocodeCandidate[];
  try {
    candidates = await external.geocode(input.query);
  } catch {
    return { outcome: "timeout", sourceClass: "external", candidates: [] };
  }
  if (candidates.length === 0) return { outcome: "no_result", sourceClass: null, candidates: [] };
  const limited = candidates.slice(0, input.limit);
  return { outcome: outcomeOf(limited), sourceClass: "external", candidates: limited };
}
