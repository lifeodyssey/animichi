import { queryOptions, useQuery } from "@tanstack/react-query";
import { fetchPopular } from "../popular";

/** Query options for the popular ranking, keyed under `["popular", limit]`. */
export function popularRankingOptions(limit = 8) {
  return queryOptions({ queryKey: ["popular", limit], queryFn: () => fetchPopular(limit) });
}

export function usePopularRanking(limit = 8) {
  return useQuery(popularRankingOptions(limit));
}
