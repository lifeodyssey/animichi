import type {
  ClaimRoutesInput,
  ClaimRoutesResult,
  DeleteRouteInput,
  DeleteRouteResult,
  ListRoutesResult,
  SaveRouteInput,
  UserRoute,
} from "@animichi/contract";

/**
 * Persistence port for user-scoped saved routes. The Neon adapter lives in
 * src/adapters/neon-saved-route-repo.ts; tests substitute an in-memory repo.
 * Implementations own all route SQL and map domain failures (missing row,
 * RouteNotOwnedError from src/domain/route-rules.ts) to service errors.
 */
export interface SavedRouteRepo {
  /** List routes owned by a user, newest update first. */
  listRoutes: (userId: string) => Promise<ListRoutesResult>;
  /** Create a route, or update it after explicit ownership validation. */
  saveRoute: (userId: string, input: SaveRouteInput) => Promise<UserRoute>;
  /** Delete a route after explicit ownership validation. */
  deleteRoute: (userId: string, input: DeleteRouteInput) => Promise<DeleteRouteResult>;
  /** Atomically claim this session's still-anonymous routes for the caller. */
  claimRoutes: (userId: string, input: ClaimRoutesInput) => Promise<ClaimRoutesResult>;
}
