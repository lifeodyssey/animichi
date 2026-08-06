import type { RouteStatus, TimedItinerary } from "@animichi/contract";

/**
 * The route detail page is one living document, not three patched-together
 * screens (spec-route-detail §1): the same page lights up different elements
 * from the data. This module derives that data-illuminated state purely, with
 * the clock injected so it is deterministic under test.
 */

/** Additive-only payload version for the route-detail generative components. */
export const ROUTE_DETAIL_SCHEMA_VERSION = 1;

/** Which elements the page illuminates, chosen by data (never a mode toggle). */
export type RouteDataState = "completed" | "today" | "weekday";

/**
 * Composed route-detail view model: the contract itinerary plus the user
 * metadata the data-illuminated states read. `scheduledDate` and `itinerary`
 * are the S2.8 integration seam — null in the shell until the detail endpoint
 * enriches them; the components render skeleton slots meanwhile.
 */
export interface RouteDetail {
  readonly id: string;
  readonly title: string;
  readonly status: RouteStatus;
  readonly scheduledDate: string | null;
  readonly itinerary: TimedItinerary | null;
  readonly checkins: readonly string[];
  readonly pointCount: number;
}

/** A route with zero saved points renders the empty state, not a skeleton. */
export function isRouteEmpty(detail: RouteDetail): boolean {
  return detail.pointCount === 0;
}

function isSameCalendarDay(dateIso: string, now: Date): boolean {
  const scheduled = new Date(`${dateIso}T00:00:00`);
  const sameMonth = scheduled.getMonth() === now.getMonth();
  const sameDate = scheduled.getDate() === now.getDate();
  return scheduled.getFullYear() === now.getFullYear() && sameMonth && sameDate;
}

/** True when the route is dated for `now`'s calendar day. */
export function isToday(detail: RouteDetail, now: Date): boolean {
  return detail.scheduledDate !== null && isSameCalendarDay(detail.scheduledDate, now);
}

/** Priority rule: completed > today > weekday (never two banners at once). */
export function deriveRouteDataState(detail: RouteDetail, now: Date): RouteDataState {
  if (detail.status === "completed") return "completed";
  if (isToday(detail, now)) return "today";
  return "weekday";
}

/** A living document keeps history: a stop stays ✓ once checked in. */
export function isStopCheckedIn(detail: RouteDetail, clusterId: string): boolean {
  return detail.checkins.includes(clusterId);
}

/** Check-in count against the loaded itinerary's stop count (完走 N/total). */
export function completedTotals(detail: RouteDetail): { readonly done: number; readonly total: number } {
  return { done: detail.checkins.length, total: detail.itinerary?.stops.length ?? 0 };
}
