import type { SavedRouteStatus } from "@animichi/contract";

/** True when `value` is a contract `SavedRouteStatus` literal. */
export function isSavedRouteStatus(value: unknown): value is SavedRouteStatus {
  return value === "draft" || value === "saved" || value === "completed";
}

/** saved_at policy: a draft is never stamped, a non-draft keeps its previous
 * stamp or is stamped `now` when it has none. Pure; `now` is injected so the
 * rule table is testable without a clock. */
export function savedAtForStatus(
  status: SavedRouteStatus,
  previousSavedAt: string | null,
  now: string,
): string | null {
  if (status === "draft") return null;
  return previousSavedAt ?? now;
}
