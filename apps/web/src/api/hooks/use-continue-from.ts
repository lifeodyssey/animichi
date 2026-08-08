import { useQuery } from "@tanstack/react-query";
import type { SavedRoute } from "@animichi/contract";
import { users } from "../orpc";

/**
 * Pick the "続きから" route: the most recently updated in-progress (`draft`)
 * route (SD-8 — depends only on sessions/routes, never `user_memory`).
 */
export function pickContinueFrom(routes: readonly SavedRoute[]): SavedRoute | undefined {
  const drafts = routes.filter((route) => route.status === "draft");
  return [...drafts].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
}

export interface ContinueFromState {
  readonly route: SavedRoute | undefined;
  readonly isPending: boolean;
}

export function useContinueFrom(): ContinueFromState {
  const query = useQuery({ ...users().listSavedRoutes.queryOptions(), retry: false });
  return { route: query.data ? pickContinueFrom(query.data.saved_routes) : undefined, isPending: query.isPending };
}
