/**
 * The session state the catalog tools read and write, for the length of one
 * turn (cards #1252 × #1253).
 *
 * It implements `CatalogToolSession` — the port `src/agent/tools/` declares —
 * and it is deliberately in-memory. What the tools put here is the heavy half
 * of a result: the rows the web renders, keyed by the opaque ref the model is
 * given instead. That ref only has to survive from the step that minted it to a
 * later step of the same run, which is exactly the lifetime of this object.
 *
 * Two things it does NOT yet do, both waiting on plumbing that does not exist:
 *   - It is not rebuilt on a REPLAY. `TurnSteps` answers a replayed step from
 *     `run_steps.result` without calling `execute`, so a ref minted before a
 *     crash is not in this map afterwards and `plan_route` would report
 *     `stale_ref`. Closing that means rehydrating from the settled steps, which
 *     is `TurnSteps`' side of the seam, not this one's.
 *   - The pending clarification and the current anime do not outlive the turn.
 *     Python kept both in the session envelope so the NEXT turn could resolve
 *     the question it asked; no column carries them yet.
 */
import type {
  CatalogToolSession,
  CurrentAnime,
  ItineraryPayload,
  OrderedCandidate,
  SearchResultPayload,
} from "../tools/catalog-tool-session.ts";
import type { LatLng } from "@animichi/contract";

/** A clarification the turn is waiting on, as the tools recorded it. */
export interface PendingClarification {
  readonly reason: string;
  readonly candidates: readonly OrderedCandidate[];
}

/** What one turn knows about itself before any tool has run. */
export interface TurnCatalogSessionParts {
  /** The language rows are rendered in — city names are localized to it. */
  readonly locale: string;
  /** The user's own coordinates, when the client shared them. */
  readonly origin?: LatLng;
}

export class TurnCatalogSession implements CatalogToolSession {
  readonly locale: string;
  readonly origin?: LatLng;
  readonly #searches = new Map<string, SearchResultPayload>();
  readonly #itineraries = new Map<string, ItineraryPayload>();
  #sequence = 0;
  #pending: PendingClarification | null = null;
  #anime: CurrentAnime | null = null;

  constructor(parts: TurnCatalogSessionParts) {
    this.locale = parts.locale;
    this.origin = parts.origin;
  }

  /** The clarification the turn is waiting on, or none. */
  get pendingClarification(): PendingClarification | null {
    return this.#pending;
  }

  /** The work this turn resolved, or none. */
  get currentAnime(): CurrentAnime | null {
    return this.#anime;
  }

  /** The route payloads this turn planned, keyed by their own refs. */
  get itineraries(): ReadonlyMap<string, ItineraryPayload> {
    return this.#itineraries;
  }

  storeSearchResult(payload: SearchResultPayload): string {
    const ref = this.#mint("search", payload.row_count);
    this.#searches.set(ref, payload);
    return ref;
  }

  searchResult(ref: string): SearchResultPayload | undefined {
    return this.#searches.get(ref);
  }

  storeItinerary(payload: ItineraryPayload): string {
    const ref = this.#mint("route", payload.summary.point_count);
    this.#itineraries.set(ref, payload);
    return ref;
  }

  setPendingClarification(reason: string, candidates: OrderedCandidate[]): void {
    this.#pending = { reason, candidates };
  }

  clearPendingClarification(): void {
    this.#pending = null;
  }

  setCurrentAnime(anime: CurrentAnime): void {
    this.#anime = anime;
  }

  /** Python's `RefFactory`: `"{kind}:{row_count}:{sequence}"`, minted once. */
  #mint(kind: string, revision: number): string {
    this.#sequence += 1;
    return `${kind}:${String(revision)}:${String(this.#sequence)}`;
  }
}
