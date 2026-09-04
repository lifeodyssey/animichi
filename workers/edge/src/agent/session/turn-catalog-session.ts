/**
 * The session state the catalog tools read and write, for the length of one
 * turn (cards #1252 × #1253, seeded across turns by #1280).
 *
 * It implements `CatalogToolSession` — the port `src/agent/tools/` declares —
 * and it holds two things with two different lifetimes. The heavy half of a
 * result (the rows the web renders, keyed by the opaque ref the model is given
 * instead) is per RUN and stays in memory: that ref only has to survive from the
 * step that minted it to a later step of the same run. The `SessionEnvelope` is
 * per SESSION, arrives from storage and goes back to it, which is why it is a
 * value here rather than two fields.
 *
 * It is also the turn's `TurnMemory` (#1290): the fact ledger and the retained
 * entities live in that same envelope, so the compaction hook and the fact
 * recorder write through the object that already owns it rather than through a
 * second holder that would have to be merged back.
 *
 * IT IS REBUILT ON A REPLAY (#1279). A settled step is answered from
 * `run_steps.result` without calling `execute`, so every ref this mints is
 * recorded on the step that minted it (`minted-refs.ts`) and put back through
 * `remint` before a retried alarm resumes the loop — same ref, same rows, and
 * the sequence carried on from there.
 */
import type { SessionMemory, TurnMemory } from "../memory/session-memory.ts";
import type { MintedRefs, StepMint } from "./minted-refs.ts";
import type {
  CatalogToolSession,
  CurrentAnime,
  ItineraryPayload,
  OrderedCandidate,
  SearchResultPayload,
} from "../tools/catalog-tool-session.ts";
import { SessionEnvelope } from "./session-envelope.ts";
import type { LatLng } from "@animichi/contract";

/** What one turn knows about itself before any tool has run. */
export interface TurnCatalogSessionParts {
  /** The language rows are rendered in — city names are localized to it. */
  readonly locale: string;
  /** The user's own coordinates, when the client shared them. */
  readonly origin?: LatLng;
  /** What earlier turns of this session left behind (#1280). */
  readonly envelope?: SessionEnvelope;
}

export class TurnCatalogSession implements CatalogToolSession, MintedRefs, TurnMemory {
  readonly locale: string;
  readonly origin?: LatLng;
  readonly #searches = new Map<string, SearchResultPayload>();
  readonly #itineraries = new Map<string, ItineraryPayload>();
  readonly #minted: StepMint[] = [];
  #sequence = 0;
  #envelope: SessionEnvelope;

  constructor(parts: TurnCatalogSessionParts) {
    this.locale = parts.locale;
    this.origin = parts.origin;
    this.#envelope = parts.envelope ?? SessionEnvelope.empty;
  }

  /** What this session carries between turns, as it stands right now. */
  get envelope(): SessionEnvelope {
    return this.#envelope;
  }

  /** `TurnMemory`: the two ledgers this turn reads and replaces (#1290). */
  get memory(): SessionMemory {
    return this.#envelope.memory;
  }

  /** `TurnMemory`: the title `currentAnime` already carries in full. */
  get resolvedTitle(): string | null {
    return this.#envelope.currentAnime?.title ?? null;
  }

  /** `TurnMemory`: publish what compaction rescued and the recorder recorded. */
  remember(memory: SessionMemory): void {
    this.#envelope = this.#envelope.remembering(memory);
  }

  /** The route payloads this turn planned, keyed by their own refs. */
  get itineraries(): ReadonlyMap<string, ItineraryPayload> {
    return this.#itineraries;
  }

  /** The search payloads this turn found, in the order the tools stored them —
   * which is what tells an answer WHICH search it is about (#1283). */
  get searchResults(): ReadonlyMap<string, SearchResultPayload> {
    return this.#searches;
  }

  /** `MintedRefs`: how many refs this run has minted so far (#1279). */
  get mintCount(): number {
    return this.#minted.length;
  }

  /** `MintedRefs`: the refs minted after a mark — what one step added. */
  mintedSince(mark: number): readonly StepMint[] {
    return this.#minted.slice(mark);
  }

  storeSearchResult(payload: SearchResultPayload): string {
    return this.#filed({ kind: "search", ref: this.#mint("search", payload.row_count), payload });
  }

  searchResult(ref: string): SearchResultPayload | undefined {
    return this.#searches.get(ref);
  }

  storeItinerary(payload: ItineraryPayload): string {
    const ref = this.#mint("route", payload.summary.point_count);
    return this.#filed({ kind: "route", ref, payload });
  }

  /**
   * `MintedRefs`: put back what one settled step minted (#1279).
   *
   * The sequence advances per mint rather than being read off the ref, so the
   * next NEW ref of this run continues where the crashed attempt stopped; the
   * ref itself is the STORED one, because that is the handle the model was
   * given and the one a later step will name.
   */
  remint(mints: readonly StepMint[]): void {
    for (const mint of mints) {
      this.#sequence += 1;
      this.#filed(mint);
    }
  }

  setPendingClarification(reason: string, candidates: OrderedCandidate[]): void {
    this.#envelope = this.#envelope.withClarification(reason, candidates);
  }

  clearPendingClarification(): void {
    this.#envelope = this.#envelope.cleared();
  }

  setCurrentAnime(anime: CurrentAnime | null): void {
    this.#envelope = this.#envelope.withAnime(anime);
  }

  /** File one mint under its ref, whether it was just minted or put back. */
  #filed(mint: StepMint): string {
    if (mint.kind === "search") this.#searches.set(mint.ref, mint.payload);
    else this.#itineraries.set(mint.ref, mint.payload);
    this.#minted.push(mint);
    return mint.ref;
  }

  /** Python's `RefFactory`: `"{kind}:{row_count}:{sequence}"`, minted once. */
  #mint(kind: string, revision: number): string {
    this.#sequence += 1;
    return `${kind}:${String(revision)}:${String(this.#sequence)}`;
  }
}
