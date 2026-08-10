/**
 * Outbound adapter for the `UpstreamTitlePort`: the explicit upstream-ingest
 * adapter over the Bangumi search fetcher. Maps the fetcher's typed transport
 * failure to the `upstream_unavailable` sentinel; every other failure stays an
 * error. Search policy (similarity, cap) stays in the application use case.
 */

import type { UpstreamSubjects, UpstreamTitlePort } from "../../application/resolve-bangumi";
import type { RetryOptions } from "../../ingest/retry";
import {
  BANGUMI_FETCH_N,
  fetchBangumiSubjects,
  UpstreamFetchError,
  type FetchLike,
} from "../../ingest/sources";

/** Injectable knobs for the Bangumi search adapter (defaulted for prod). */
export interface BangumiTitleSearchConfig {
  fetchImpl?: FetchLike;
  retry?: RetryOptions;
}

/** Build the `UpstreamTitlePort` backed by the Bangumi search fetcher. */
export function bangumiTitleSearch(cfg: BangumiTitleSearchConfig = {}): UpstreamTitlePort {
  return { fetchSubjects: (query) => fetchSubjects(query, cfg) };
}

async function fetchSubjects(
  query: string,
  cfg: BangumiTitleSearchConfig,
): Promise<UpstreamSubjects> {
  try {
    return await fetchBangumiSubjects(query, { limit: BANGUMI_FETCH_N, ...cfg });
  } catch (error) {
    if (error instanceof UpstreamFetchError) return "upstream_unavailable";
    throw error;
  }
}
