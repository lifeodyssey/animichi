import { useQuery } from "@tanstack/react-query";
import { catalog } from "../orpc";

/** Query options for the popular ranking, keyed under `["catalog", "popular", limit]`. */
export function popularRankingOptions(limit = 8) {
  return catalog().popular.queryOptions({ input: { limit }, queryKey: ["popular", limit] });
}

export function usePopularRanking(limit = 8) {
  return useQuery(popularRankingOptions(limit));
}
