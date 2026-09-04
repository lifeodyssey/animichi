/**
 * The two heavy payloads a ref names, read back out of a `jsonb` column.
 *
 * They are written by one turn and read by another attempt at it — a selection
 * step's `SelectionRecord` (#1288) and a settled step's mints (#1279) both
 * carry them through `run_steps.result` — so both readers need the same
 * question answered: is this thing the driver handed back really the payload it
 * was written as? Each is checked on the one field every reader branches on,
 * which is as far as a shape check is worth taking here: the column is written
 * by this tier and read back within one run's deadline.
 */
import { isJsonRecord } from "../json-record.ts";
import type { ItineraryPayload, SearchResultPayload } from "./catalog-tool-session.ts";

/** A stored search payload, or null when the value is not one. */
export function storedSearchResult(value: unknown): SearchResultPayload | null {
  if (!isJsonRecord(value) || !Array.isArray(value.rows)) return null;
  return typeof value.row_count === "number" ? (value as unknown as SearchResultPayload) : null;
}

/** A stored route, checked the way `expectItinerary` checks a catalog body. */
export function storedItinerary(value: unknown): ItineraryPayload | null {
  if (!isJsonRecord(value) || !Array.isArray(value.ordered_points)) return null;
  return isJsonRecord(value.timed_itinerary) ? (value as unknown as ItineraryPayload) : null;
}
