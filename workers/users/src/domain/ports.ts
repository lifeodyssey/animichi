import type {
  ClaimSavedRoutesInput,
  ClaimSavedRoutesResult,
  ListSavedRoutesResult,
} from "@animichi/contract";

/**
 * Persistence port for user-scoped saved routes. The Neon adapter lives in
 * src/adapters/neon-saved-route-repo.ts; tests substitute an in-memory repo.
 * Implementations own all saved-route SQL. The create-or-update save path is
 * the SaveSavedRoute action (src/application/save-saved-route.ts) and the
 * delete path is the DeleteSavedRoute action
 * (src/application/delete-saved-route.ts) — neither is a repo method.
 */
export interface SavedRouteRepo {
  /** List saved routes owned by a user, newest update first. */
  listSavedRoutes: (userId: string) => Promise<ListSavedRoutesResult>;
  /** Atomically claim this session's still-anonymous saved routes for the caller. */
  claimSavedRoutes: (userId: string, input: ClaimSavedRoutesInput) => Promise<ClaimSavedRoutesResult>;
}
