import type { TimedStop } from "@animichi/contract";
import { completedTotals, isStopCheckedIn } from "./dataState";
import type { RouteDetail } from "./dataState";

/**
 * Map-pin language (spec-route-detail §5 "pin-is-the-picture"): each stop reads
 * as visited (済 ✓), current (現在 ★ gold ring), or not-yet-visited (white
 * numbered). Derived purely from check-ins so the map layer stays presentational
 * and the gold route pill (progress N/total) reuses the same source of truth.
 */
export type PinState = "visited" | "current" | "unvisited";

/** A ready-to-render pin: stable id, its ordinal label, and its data state. */
export interface RoutePin {
  readonly id: string;
  readonly label: string;
  readonly state: PinState;
}

function routeStops(detail: RouteDetail): readonly TimedStop[] {
  return detail.itinerary?.stops ?? [];
}

function firstUnvisitedIndex(detail: RouteDetail): number {
  return routeStops(detail).findIndex((stop) => !isStopCheckedIn(detail, stop.cluster_id));
}

/** The one "現在" pin: the next unvisited stop, only while a journey is underway. */
function currentPinIndex(detail: RouteDetail): number {
  const { done, total } = completedTotals(detail);
  if (done === 0 || done >= total) return -1;
  return firstUnvisitedIndex(detail);
}

function pinStateOf(detail: RouteDetail, stop: TimedStop, index: number, current: number): PinState {
  if (isStopCheckedIn(detail, stop.cluster_id)) return "visited";
  return index === current ? "current" : "unvisited";
}

/** Map every itinerary stop to its rendered pin, aligned to the timetable order. */
export function toRoutePins(detail: RouteDetail): readonly RoutePin[] {
  const current = currentPinIndex(detail);
  return routeStops(detail).map((stop, index) => ({
    id: stop.cluster_id,
    label: String(index + 1),
    state: pinStateOf(detail, stop, index, current),
  }));
}

/** Gold route pill progress copy (spec-route-detail §5: "N/5"). */
export function routeProgressLabel(detail: RouteDetail): string {
  const { done, total } = completedTotals(detail);
  return `${String(done)}/${String(total)}`;
}

/** Badge glyph overlaid on the pin: ✓ for visited, ★ for current, none otherwise. */
export function pinBadge(state: PinState): string | null {
  if (state === "visited") return "✓";
  if (state === "current") return "★";
  return null;
}

/** The current pin swells to a 58px gold ring; every other pin is a 48px frame. */
export function pinSizePx(state: PinState): number {
  return state === "current" ? 58 : 48;
}
