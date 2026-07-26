import type { Pacing, TimedItinerary, TimedStop, TransitLeg } from "@seichijunrei/contract";

/** One station row on the S1.5 route timeline (issue #271 AC: HH:MM granularity). */
export interface ItineraryStation {
  readonly id: string;
  readonly name: string;
  readonly arrive?: string;
  readonly depart?: string;
  readonly highlighted: boolean;
}

/** A between-station leg rendered as a walk capsule or transit chip. */
export interface ItineraryLeg {
  readonly mode: "walk" | "transit";
  readonly minutes: number;
}

/** View model for the timed-itinerary card; `legs[i]` sits after `stations[i]`. */
export interface ItineraryView {
  readonly stations: readonly ItineraryStation[];
  readonly legs: readonly (ItineraryLeg | undefined)[];
  readonly pacing?: Pacing;
  readonly mapsUrl?: string;
}

/** Upstream sends sentinels, not omissions: `""` marks a missing HH:MM string. */
function timeOf(value: string): string | undefined {
  return value === "" ? undefined : value;
}

/** The gold star sits on the most-photographed station (first among ties). */
function highlightIndex(stops: readonly TimedStop[]): number {
  let best = 0;
  for (const [index, stop] of stops.entries()) {
    if (stop.photo_count > (stops[best]?.photo_count ?? 0)) best = index;
  }
  return best;
}

function toStation(stop: TimedStop, highlighted: boolean): ItineraryStation {
  return {
    id: stop.cluster_id,
    name: stop.name,
    arrive: timeOf(stop.arrive),
    depart: timeOf(stop.depart),
    highlighted,
  };
}

function legBetween(legs: readonly TransitLeg[], fromId: string, toId: string): ItineraryLeg | undefined {
  const leg = legs.find((candidate) => candidate.from_id === fromId && candidate.to_id === toId);
  if (!leg) return undefined;
  return { mode: leg.mode, minutes: leg.duration_minutes };
}

function pairLegs(stops: readonly TimedStop[], legs: readonly TransitLeg[]): readonly (ItineraryLeg | undefined)[] {
  return stops.slice(1).map((next, index) => {
    const prev = stops[index];
    return prev ? legBetween(legs, prev.cluster_id, next.cluster_id) : undefined;
  });
}

/** The sentinel for a missing export link is `""`, which `??` passes through. */
function firstMapsUrl(urls: readonly string[] | undefined): string | undefined {
  return urls?.find((url) => url !== "");
}

export function itineraryView(itinerary: TimedItinerary): ItineraryView {
  const stops = itinerary.stops;
  const star = highlightIndex(stops);
  return {
    stations: stops.map((stop, index) => toStation(stop, index === star)),
    legs: pairLegs(stops, itinerary.legs),
    pacing: itinerary.pacing,
    mapsUrl: firstMapsUrl(itinerary.export_google_maps_url),
  };
}
