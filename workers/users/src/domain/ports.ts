import type {
  ClaimSavedRoutesInput,
  ClaimSavedRoutesResult,
} from "@animichi/contract";

/**
 * Persistence port for user-scoped saved routes. The Neon adapter lives in
 * src/adapters/neon-saved-route-repo.ts; tests substitute an in-memory repo.
 * Implementations own all saved-route SQL. The create-or-update save path is
 * the SaveSavedRoute action (src/application/save-saved-route.ts), the read
 * journey is the ListSavedRoutes action (src/application/list-saved-routes.ts),
 * and the delete path is the DeleteSavedRoute action
 * (src/application/delete-saved-route.ts) — none of them are repo methods.
 */
export interface SavedRouteRepo {
  /** Atomically claim this session's still-anonymous saved routes for the caller. */
  claimSavedRoutes: (userId: string, input: ClaimSavedRoutesInput) => Promise<ClaimSavedRoutesResult>;
}
