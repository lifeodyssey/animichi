import type { TimedItinerary } from "@seichijunrei/contract";
import { selectShioriLayout, type ShioriLayout, type ShioriStatus } from "./layoutSelector";
import { shioriTimeWindow } from "./timeWindow";
import type { ShioriMeta, ShioriPhoto } from "./types";

export type ShioriMode = "planned" | "commemorative";

/** Everything the auto-composer needs; the caller decides "day over" (mock the clock). */
export interface ShioriSource {
  meta: ShioriMeta;
  itinerary: TimedItinerary;
  photos: readonly ShioriPhoto[];
  checkedStopIds: readonly string[];
  isRouteDayOver: boolean;
}

export interface ShioriStats {
  walkMinutes: number;
  distanceKm: number;
  timeWindow: string | null;
}

export interface ShioriCompletion {
  checkedCount: number;
  stopCount: number;
  ratePercent: number;
}

export interface ComposedShiori {
  mode: ShioriMode;
  status: ShioriStatus;
  layout: ShioriLayout;
  meta: ShioriMeta;
  itinerary: TimedItinerary;
  photos: readonly ShioriPhoto[];
  stats: ShioriStats;
  completion: ShioriCompletion | null;
}

/** Auto-generates the しおり: the route's data state picks the mode, never the user (S4.2). */
export function composeShiori(source: ShioriSource): ComposedShiori {
  const mode = resolveMode(source);
  const status: ShioriStatus = mode === "commemorative" ? "completed" : "planned";
  const { meta, itinerary, photos } = source;
  const completion = mode === "commemorative" ? composeCompletion(source) : null;
  const layout = selectShioriLayout(status, photos.length);
  return { mode, status, layout, meta, itinerary, photos, stats: composeStats(itinerary), completion };
}

function resolveMode(source: ShioriSource): ShioriMode {
  const stopCount = source.itinerary.stops.length;
  const checked = countCheckedStops(source);
  if (stopCount === 0 || checked === 0) return "planned";
  if (checked === stopCount) return "commemorative";
  return source.isRouteDayOver ? "commemorative" : "planned";
}

function countCheckedStops({ itinerary, checkedStopIds }: ShioriSource): number {
  const checked = new Set(checkedStopIds);
  return itinerary.stops.filter((stop) => checked.has(stop.cluster_id)).length;
}

function composeCompletion(source: ShioriSource): ShioriCompletion {
  const checkedCount = countCheckedStops(source);
  const stopCount = source.itinerary.stops.length;
  return { checkedCount, stopCount, ratePercent: Math.round((checkedCount / stopCount) * 100) };
}

function composeStats(itinerary: TimedItinerary): ShioriStats {
  return {
    walkMinutes: itinerary.total_minutes,
    distanceKm: Math.round(itinerary.total_distance_m / 100) / 10,
    timeWindow: shioriTimeWindow(itinerary),
  };
}
