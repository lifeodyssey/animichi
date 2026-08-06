import type { TimedItinerary } from "@animichi/contract";

/** First arrival → last departure, e.g. "09:31→12:58"; null when there are no stops. */
export function shioriTimeWindow(itinerary: TimedItinerary): string | null {
  const [first] = itinerary.stops;
  const last = itinerary.stops.at(-1);
  if (!first || !last) return null;
  return `${first.arrive}→${last.depart}`;
}
