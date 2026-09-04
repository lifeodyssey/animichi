/**
 * What one selection step settles under `(run_id, step_index)` (card #1288).
 *
 * THE RECORD IS THE REPLAY. Spec §三 requires a side-effecting step to be
 * idempotent on that key, and `TurnSteps` delivers that by answering a settled
 * step from `run_steps.result` WITHOUT calling `execute` again. So everything
 * the answer is built from has to be IN the result: the merged rows, the
 * planned route, the works that contributed nothing. A step that recorded only
 * a ref would replay into a session that never minted it — the gap
 * `turn-catalog-session.ts` documents and #1279 owns generally; a selection
 * closes it for its own steps by carrying the payloads themselves.
 *
 * Which is also why the session's side effects are applied from the RECORD on
 * both paths rather than inside `execute`: the executed and the replayed turn
 * then take the same code, so "the itinerary is stored exactly once per run"
 * needs no second implementation to be true on the retry.
 */
import { isJsonRecord } from "../json-record.ts";
import type { ItineraryPayload, SearchResultPayload } from "../tools/catalog-tool-session.ts";

/** The status every selection path reports on a catalog that would not answer.
 * Python spells it the same on all three (`_multi_terminal` `"error"`,
 * `_place_error`, `_error_result`). */
export const SELECTION_ERROR = "error";

/** One settled selection step. */
export interface SelectionRecord {
  /** The outcome word, in the path's own vocabulary (`ok`, `empty`,
   * `partial`, `too_large`, `error`). */
  readonly status: string;
  readonly search: SearchResultPayload | null;
  readonly itinerary: ItineraryPayload | null;
  /** The titles of the works the merge left out, for the disclosure sentence. */
  readonly omitted: readonly string[];
}

/** A record with nothing behind it: what every failing path settles. */
export function refusedRecord(status: string = SELECTION_ERROR): SelectionRecord {
  return { status, search: null, itinerary: null, omitted: [] };
}

/** One record with its defaults filled in, so callers name only what they have. */
export function selectionRecord(record: Partial<SelectionRecord> & { status: string }): SelectionRecord {
  return { search: null, itinerary: null, omitted: [], ...record };
}

/** A stored search payload, checked on the one field every reader branches on. */
function storedSearch(value: unknown): SearchResultPayload | null {
  if (!isJsonRecord(value) || !Array.isArray(value.rows)) return null;
  return typeof value.row_count === "number" ? (value as unknown as SearchResultPayload) : null;
}

/** A stored route, checked the way `expectItinerary` checks a catalog body. */
function storedItinerary(value: unknown): ItineraryPayload | null {
  if (!isJsonRecord(value) || !Array.isArray(value.ordered_points)) return null;
  return isJsonRecord(value.timed_itinerary) ? (value as unknown as ItineraryPayload) : null;
}

function storedTitles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * The record a settled step holds.
 *
 * A result this cannot read reads as the catalog failure it most resembles,
 * rather than as a re-execution: the step ALREADY ran, the catalog already
 * answered, and running it again is the one thing the idempotency key exists to
 * prevent. The case is narrow — the column is written by this module and read
 * back within one run's deadline — but a deploy can land between the two.
 */
export function recordIn(details: unknown): SelectionRecord {
  if (!isJsonRecord(details) || typeof details.status !== "string") return refusedRecord();
  return {
    status: details.status,
    search: storedSearch(details.search),
    itinerary: storedItinerary(details.itinerary),
    omitted: storedTitles(details.omitted),
  };
}
