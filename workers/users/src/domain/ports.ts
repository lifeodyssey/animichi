import type {
  ClaimSavedRoutesInput,
  ClaimSavedRoutesResult,
  DeleteSavedRouteInput,
  DeleteSavedRouteResult,
  ListSavedRoutesResult,
  SaveSavedRouteInput,
  SavedRoute,
} from "@animichi/contract";

/**
 * Persistence port for user-scoped saved routes. The Neon adapter lives in
 * src/adapters/neon-saved-route-repo.ts; tests substitute an in-memory repo.
 * Implementations own all saved-route SQL and map domain failures (missing
 * row, SavedRouteNotOwnedError from src/domain/route-rules.ts) to service
 * errors.
 */
export interface SavedRouteRepo {
  /** List saved routes owned by a user, newest update first. */
  listSavedRoutes: (userId: string) => Promise<ListSavedRoutesResult>;
  /** Create a saved route, or update it after explicit ownership validation. */
  saveSavedRoute: (userId: string, input: SaveSavedRouteInput) => Promise<SavedRoute>;
  /** Delete a saved route after explicit ownership validation. */
  deleteSavedRoute: (userId: string, input: DeleteSavedRouteInput) => Promise<DeleteSavedRouteResult>;
  /** Atomically claim this session's still-anonymous saved routes for the caller. */
  claimSavedRoutes: (userId: string, input: ClaimSavedRoutesInput) => Promise<ClaimSavedRoutesResult>;
}
