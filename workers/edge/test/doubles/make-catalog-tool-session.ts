/** An in-memory `CatalogToolSession` that mints refs the way Python's
 * `RefFactory` did (`"{kind}:{row_count}:{sequence}"`), so a test can assert
 * the exact ref string a tool reports back to the model. Named for what it
 * builds, per .claude/rules/naming-ownership.md. */
import type { LatLng } from "@animichi/contract";
import type {
  CatalogToolSession,
  CurrentAnime,
  ItineraryPayload,
  OrderedCandidate,
  SearchResultPayload,
} from "../../src/agent/tools/catalog-tool-session.ts";

/** One pending clarification, as the session recorded it. */
export interface RecordedClarification {
  reason: string;
  candidates: OrderedCandidate[];
}

/** Everything a test wants to read back off the session. */
export interface RecordingToolSession extends CatalogToolSession {
  readonly searches: Map<string, SearchResultPayload>;
  readonly itineraries: ItineraryPayload[];
  readonly clarifications: (RecordedClarification | "cleared")[];
  readonly animes: CurrentAnime[];
}

/** Build a recording session, optionally with the user's own coordinates. */
export function makeCatalogToolSession(origin?: LatLng, locale = "ja"): RecordingToolSession {
  const searches = new Map<string, SearchResultPayload>();
  const itineraries: ItineraryPayload[] = [];
  const clarifications: (RecordedClarification | "cleared")[] = [];
  const animes: CurrentAnime[] = [];
  let sequence = 0;
  const mint = (kind: string, revision: number): string => {
    sequence += 1;
    return `${kind}:${String(revision)}:${String(sequence)}`;
  };
  return {
    origin,
    locale,
    searches,
    itineraries,
    clarifications,
    animes,
    storeSearchResult: (payload) => {
      const ref = mint("search", payload.row_count);
      searches.set(ref, payload);
      return ref;
    },
    searchResult: (ref) => searches.get(ref),
    storeItinerary: (payload) => {
      itineraries.push(payload);
      return mint("route", payload.summary.point_count);
    },
    setPendingClarification: (reason, candidates) => clarifications.push({ reason, candidates }),
    clearPendingClarification: () => clarifications.push("cleared"),
    setCurrentAnime: (anime) => animes.push(anime),
  };
}
