import { useQuery } from "@tanstack/react-query";
import type { UserRoute } from "@animichi/contract";
import { users } from "../orpc";

/**
 * Pick the "続きから" route: the most recently updated in-progress (`draft`)
 * route (SD-8 — depends only on sessions/routes, never `user_memory`).
 */
export function pickContinueFrom(routes: readonly UserRoute[]): UserRoute | undefined {
  const drafts = routes.filter((route) => route.status === "draft");
  return [...drafts].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
}

export interface ContinueFromState {
  readonly route: UserRoute | undefined;
  readonly isPending: boolean;
}

export function useContinueFrom(): ContinueFromState {
  const query = useQuery({ ...users().listRoutes.queryOptions(), retry: false });
  return { route: query.data ? pickContinueFrom(query.data.routes) : undefined, isPending: query.isPending };
}
