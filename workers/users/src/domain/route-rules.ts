/** Pure domain error — the adapter maps it to the oRPC savedRouteNotOwned error. */
export class SavedRouteNotOwnedError extends Error {
  readonly savedRouteId: string;

  constructor(savedRouteId: string) {
    super(`Route belongs to another user: ${savedRouteId}`);
    this.name = "SavedRouteNotOwnedError";
    this.savedRouteId = savedRouteId;
  }
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
