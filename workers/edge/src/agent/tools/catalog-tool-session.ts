/**
 * The session state the catalog tools read and write, as a port.
 *
 * Port of what `apps/agent`'s `RuntimeDeps.tool_state.session` gave the tools:
 * a registry that mints opaque refs for heavy payloads, the pending
 * clarification the next turn must resolve, and the anime the session is
 * currently about. The tools never hold this state themselves — one turn's DO
 * owns it, so `AgentSession` (#1252) is what implements this interface.
 */

import type { Itinerary, LatLng, Point, TimedItinerary } from "@animichi/contract";

/** One choice offered to the user when a tool cannot decide alone. */
export interface OrderedCandidate {
  id: string;
  title: string;
  cover_url?: string;
  points_count?: number;
  lat?: number;
  lng?: number;
  effective_radius_m?: number;
}

/** Display metadata derived from a result's first row. */
export interface SearchMetadata {
  anime_title?: string;
  anime_title_cn?: string;
  cover_url?: string;
  data_origin: "catalog";
  source: "catalog";
}

/**
 * One stored search result: the rows the web renders, keyed by an opaque ref.
 *
 * `multi` is the third kind Python's `SearchPayloadState` carried and the one no
 * model tool can produce: it is the deterministic merge of several works a user
 * picked at once (`src/agent/selection/`, #1288). The contract's
 * `SearchResults.kind` has always admitted it.
 */
export interface SearchResultPayload {
  kind: "bangumi" | "nearby" | "multi";
  rows: Point[];
  row_count: number;
  metadata: SearchMetadata | null;
  anime_id: string | null;
  partial: boolean;
}

/** The headline numbers a stored route reports. */
export interface ItinerarySummary {
  point_count: number;
  total_minutes: number;
  total_distance_m: number;
  clusters: number;
  with_coordinates: number;
  without_coordinates: number;
}

/** One stored route, and the search result it was planned over — `null` when
 * the points came from the user's own pick rather than from a stored search
 * (Python passed `source_ref=None` on that path). */
export interface ItineraryPayload {
  ordered_points: Point[];
  timed_itinerary: TimedItinerary;
  summary: ItinerarySummary;
  source_ref: string | null;
}

/** The anime a resolved turn is about. */
export interface CurrentAnime {
  bangumiId: string;
  title: string;
}

/**
 * What one session offers the catalog tools.
 *
 * `storeSearchResult` / `storeItinerary` MINT the ref they return — Python's
 * `RefFactory` shaped it `"{kind}:{row_count}:{sequence}"` and reserved
 * hydrated refs so a resumed session never mints one twice. That sequence
 * belongs to whoever owns the session across a turn, which is why minting sits
 * behind this port rather than inside a tool.
 */
export interface CatalogToolSession {
  /** Store a search result and return the ref the model may name later. */
  storeSearchResult(payload: SearchResultPayload): string;
  /** The payload a ref names, or `undefined` when this session never minted it. */
  searchResult(ref: string): SearchResultPayload | undefined;
  /** Store a planned route and return its own ref. */
  storeItinerary(payload: ItineraryPayload): string;
  /** Record that the turn cannot proceed until the user chooses. */
  setPendingClarification(reason: string, candidates: OrderedCandidate[]): void;
  /** Drop any pending clarification: this tool answered instead. */
  clearPendingClarification(): void;
  /** Remember the resolved work, so a later turn need not resolve again —
   * or forget it with `null`, which is what a pick of SEVERAL works means: the
   * session is no longer about one (Python's `_set_current_anime`, #1288). */
  setCurrentAnime(anime: CurrentAnime | null): void;
  /** The user's own coordinates, when the client shared them. */
  readonly origin?: LatLng;
  /** The language the rows are rendered in — city names are localized to it. */
  readonly locale: string;
}

/** The itinerary the catalog returned, before it becomes a stored payload. */
export type PlannedItinerary = Itinerary;
