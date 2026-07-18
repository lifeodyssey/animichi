import { useSuspenseQuery } from "@tanstack/react-query";
import { catalog } from "../orpc";

/**
 * Query options for the public anime overview, shared by the route loader
 * (`ensureQueryData` prefetch on the server) and the suspense hook (hydrated
 * client read — no double fetch, wired by `routerWithQueryClient`).
 */
export function animeOverviewOptions(bangumiId: string) {
  return catalog().animeOverview.queryOptions({ input: { bangumi_id: bangumiId } });
}

export function useAnimeOverview(bangumiId: string) {
  return useSuspenseQuery(animeOverviewOptions(bangumiId));
}
