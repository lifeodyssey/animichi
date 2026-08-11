import type {
  ClaimSavedRoutesInput,
  ClaimSavedRoutesResult,
  DeleteSavedRouteInput,
  DeleteSavedRouteResult,
  ListSavedRoutesResult,
} from "@animichi/contract";

/**
 * Persistence port for user-scoped saved routes. The Neon adapter lives in
 * src/adapters/neon-saved-route-repo.ts; tests substitute an in-memory repo.
 * Implementations own all saved-route SQL and map domain failures (missing
 * row, SavedRouteNotOwnedError from src/domain/route-rules.ts) to service
 * errors. The create-or-update save path is the SaveSavedRoute action
 * (src/application/save-saved-route.ts), not a repo method.
 */
export interface SavedRouteRepo {
  /** List saved routes owned by a user, newest update first. */
  listSavedRoutes: (userId: string) => Promise<ListSavedRoutesResult>;
  /** Delete a saved route after explicit ownership validation. */
  deleteSavedRoute: (userId: string, input: DeleteSavedRouteInput) => Promise<DeleteSavedRouteResult>;
  /** Atomically claim this session's still-anonymous saved routes for the caller. */
  claimSavedRoutes: (userId: string, input: ClaimSavedRoutesInput) => Promise<ClaimSavedRoutesResult>;
}
