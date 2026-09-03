/**
 * `search_nearby` — points around a named place, or around the user.
 *
 * Port of `animichi_tools.py::search_nearby` × `catalog_tools.py::run_nearby_search`.
 * Two catalog calls hide behind one tool: the gazetteer decides WHERE, and only
 * a place that resolves to a single non-prefecture entry is searched around.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { GeocodeCandidate, LatLng } from "@animichi/contract";
import type { CatalogClient } from "./catalog-client.ts";
import { degradingCatalogFailure } from "./catalog-failure-degradation.ts";
import type { ToolBudget } from "./catalog-timeouts.ts";
import type { CatalogToolSession, OrderedCandidate } from "./catalog-tool-session.ts";
import type { NearbyOutcome, ToolDetails } from "./catalog-tool-outcomes.ts";
import { UPSTREAM_DOWN } from "./catalog-tool-outcomes.ts";
import { buildSearchResultPayload } from "./search-result-payload.ts";
import { searchNearbyParameters } from "./tool-schema-bridge.ts";

const DESCRIPTION = "Search near a place or GPS; upstream_unavailable means retry later.";

/** The radius used when neither the model nor the gazetteer names one. */
const DEFAULT_RADIUS_M = 5_000;

/** How many gazetteer candidates one place name may return. */
const GEOCODE_LIMIT = 5;

/** Where to search, and how wide when the model named no radius. */
interface SearchOrigin {
  around: LatLng;
  radiusM: number;
}

/** One gazetteer candidate as a choice the user can be offered. */
function orderedCandidate(candidate: GeocodeCandidate): OrderedCandidate {
  return {
    id: candidate.id,
    title: candidate.label,
    lat: candidate.lat,
    lng: candidate.lng,
    effective_radius_m: candidate.effective_radius_m,
  };
}

/** No place named: fall back to the user's own coordinates, or ask for one. */
function originOrAsk(session: CatalogToolSession): SearchOrigin | NearbyOutcome {
  const origin = session.origin;
  if (origin) return { around: origin, radiusM: DEFAULT_RADIUS_M };
  session.setPendingClarification("missing_location", []);
  return { outcome: "missing_location", clarification_reason: "missing_location" };
}

/** A place nobody can search around: unknown, or a whole prefecture. */
function unresolved(
  session: CatalogToolSession,
  reason: "unknown_place" | "place_too_broad",
): NearbyOutcome {
  session.setPendingClarification(reason, []);
  return { outcome: "place_unresolved", clarification_reason: reason };
}

/** Several places answer to that name: the next turn must ask which. */
function ambiguousPlace(session: CatalogToolSession, candidates: GeocodeCandidate[]): NearbyOutcome {
  const ordered = candidates.map(orderedCandidate);
  session.setPendingClarification("place_ambiguity", ordered);
  return {
    outcome: "place_ambiguity",
    clarification_reason: "place_ambiguity",
    place_candidate_ids: ordered.map((candidate) => candidate.id),
  };
}

/** The single candidate, unless it is too broad to search around. */
function singlePlace(session: CatalogToolSession, candidate: GeocodeCandidate): SearchOrigin | NearbyOutcome {
  if (candidate.kind === "prefecture") return unresolved(session, "place_too_broad");
  return {
    around: { lat: candidate.lat, lng: candidate.lng },
    radiusM: candidate.effective_radius_m ?? DEFAULT_RADIUS_M,
  };
}

/** Turn the model's `location` into coordinates, or into something to ask. */
async function searchOrigin(
  catalog: CatalogClient,
  session: CatalogToolSession,
  location: string | undefined,
  signal?: AbortSignal,
): Promise<SearchOrigin | NearbyOutcome> {
  const place = location?.trim();
  if (!place) return originOrAsk(session);
  const candidates = await catalog.geocode(place, GEOCODE_LIMIT, signal);
  const [only] = candidates;
  if (!only) return unresolved(session, "unknown_place");
  if (candidates.length > 1) return ambiguousPlace(session, candidates);
  return singlePlace(session, only);
}

/** Distinguish a resolved origin from an outcome that ends the tool call. */
function isOrigin(resolved: SearchOrigin | NearbyOutcome): resolved is SearchOrigin {
  return "around" in resolved;
}

/** Search around a resolved origin and store what comes back. */
async function searchAround(
  catalog: CatalogClient,
  session: CatalogToolSession,
  origin: SearchOrigin,
  radiusM: number | undefined,
  signal?: AbortSignal,
): Promise<NearbyOutcome> {
  const points = await catalog.nearby(origin.around, radiusM ?? origin.radiusM, signal);
  const payload = buildSearchResultPayload(points, "nearby", null, false, session.locale);
  const ref = session.storeSearchResult(payload);
  session.clearPendingClarification();
  if (payload.row_count === 0) return { outcome: "empty" };
  return { outcome: "ok", result_ref: ref, row_count: payload.row_count };
}

/** Resolve the place, then search around it. */
async function runNearby(
  catalog: CatalogClient,
  session: CatalogToolSession,
  params: { location?: string; radius_m?: number },
  signal?: AbortSignal,
): Promise<NearbyOutcome> {
  const resolved = await searchOrigin(catalog, session, params.location, signal);
  if (!isOrigin(resolved)) return resolved;
  return searchAround(catalog, session, resolved, params.radius_m, signal);
}

/** The degraded outcome, and the pending choice it drops on the way down. */
function nearbyUpstreamDown(session: CatalogToolSession): NearbyOutcome {
  session.clearPendingClarification();
  return UPSTREAM_DOWN;
}

/** Build `search_nearby` over one session's catalog and state. */
export function searchNearbyTool(
  catalog: CatalogClient,
  session: CatalogToolSession,
  budget: ToolBudget,
): AgentTool<typeof searchNearbyParameters, ToolDetails<NearbyOutcome>> {
  return {
    name: "search_nearby",
    label: "Search pilgrimage points near a place",
    description: DESCRIPTION,
    parameters: searchNearbyParameters,
    execute: (_toolCallId, params, signal) =>
      degradingCatalogFailure("search_nearby", () => nearbyUpstreamDown(session), (deadline) =>
        runNearby(catalog, session, params, deadline), budget, signal),
  };
}
