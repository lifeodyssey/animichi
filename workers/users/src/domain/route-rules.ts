import type { RouteStatus } from "@animichi/contract";

/** Pure domain error — the adapter maps it to the oRPC routeNotOwned error. */
export class RouteNotOwnedError extends Error {
  readonly routeId: string;

  constructor(routeId: string) {
    super(`Route belongs to another user: ${routeId}`);
    this.name = "RouteNotOwnedError";
    this.routeId = routeId;
  }
}

export function isRouteStatus(value: unknown): value is RouteStatus {
  return value === "draft" || value === "saved" || value === "completed";
}

/** True when the saved route has no owning user_id (claimable). */
export function canClaimUnowned(routeUserId: string | null | undefined): boolean {
  return routeUserId == null;
}

/** Throw RouteNotOwnedError when actor is not the owner. */
export function assertRouteOwnedBy(
  ownerUserId: string | null | undefined,
  actorUserId: string,
  routeId: string,
): void {
  if (ownerUserId !== actorUserId) throw new RouteNotOwnedError(routeId);
}

/** Pure decision for saved_at SQL CASE. */
export type SavedAtPolicy = "null" | "now" | "coalesce";
export function savedAtPolicy(status: RouteStatus, mode: "insert" | "update"): SavedAtPolicy {
  if (status === "draft") return "null";
  return mode === "insert" ? "now" : "coalesce";
}
