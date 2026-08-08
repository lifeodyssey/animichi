import type { SavedRouteStatus } from "@animichi/contract";

/** Pure domain error — the adapter maps it to the oRPC savedRouteNotOwned error. */
export class SavedRouteNotOwnedError extends Error {
  readonly savedRouteId: string;

  constructor(savedRouteId: string) {
    super(`Route belongs to another user: ${savedRouteId}`);
    this.name = "SavedRouteNotOwnedError";
    this.savedRouteId = savedRouteId;
  }
}

export function isSavedRouteStatus(value: unknown): value is SavedRouteStatus {
  return value === "draft" || value === "saved" || value === "completed";
}

/** True when the saved route has no owning user_id (claimable). */
export function canClaimUnownedSavedRoute(routeUserId: string | null | undefined): boolean {
  return routeUserId == null;
}

/** Throw SavedRouteNotOwnedError when actor is not the owner. */
export function assertSavedRouteOwnedBy(
  ownerUserId: string | null | undefined,
  actorUserId: string,
  savedRouteId: string,
): void {
  if (ownerUserId !== actorUserId) throw new SavedRouteNotOwnedError(savedRouteId);
}

/** Pure decision for saved_at SQL CASE. */
export type SavedAtPolicy = "null" | "now" | "coalesce";
export function savedAtPolicy(status: SavedRouteStatus, mode: "insert" | "update"): SavedAtPolicy {
  if (status === "draft") return "null";
  return mode === "insert" ? "now" : "coalesce";
}
