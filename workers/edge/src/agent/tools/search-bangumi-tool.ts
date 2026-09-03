/**
 * `search_bangumi` — points for an already-resolved work.
 *
 * Port of `animichi_tools.py::search_bangumi` × `catalog_tools.py::run_work_search`.
 * The rows go into the session registry under a minted ref; the model gets the
 * ref and a count, never the rows.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { CatalogClient } from "./catalog-client.ts";
import { degradingCatalogFailure } from "./catalog-failure-degradation.ts";
import type { ToolBudget } from "./catalog-timeouts.ts";
import type { CatalogToolSession } from "./catalog-tool-session.ts";
import type { SearchOutcome } from "./catalog-tool-outcomes.ts";
import { UPSTREAM_DOWN } from "./catalog-tool-outcomes.ts";
import { buildSearchResultPayload } from "./search-result-payload.ts";
import { searchBangumiParameters } from "./tool-schema-bridge.ts";

const DESCRIPTION = `Fetch points by work ID; upstream_unavailable means ask the user to retry.

Do not call this for a location-only query (use \`search_nearby\` instead), and do not call it before \`resolve_anime\` has produced a bangumi_id.`;

/** Fetch the work's points, store them, and report the ref. */
async function searchWork(
  catalog: CatalogClient,
  session: CatalogToolSession,
  bangumiId: string,
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const result = await catalog.pointsByBangumiId(bangumiId, signal);
  const payload = buildSearchResultPayload(result.rows, "bangumi", bangumiId, result.partial ?? false, session.locale);
  const ref = session.storeSearchResult(payload);
  session.clearPendingClarification();
  const anime_title = payload.metadata?.anime_title ?? null;
  if (payload.row_count === 0) return { outcome: "empty", anime_title, partial: payload.partial };
  return { outcome: "ok", result_ref: ref, row_count: payload.row_count, anime_title, partial: payload.partial };
}

/** Build `search_bangumi` over one session's catalog and state. */
export function searchBangumiTool(
  catalog: CatalogClient,
  session: CatalogToolSession,
  budget: ToolBudget,
): AgentTool<typeof searchBangumiParameters, SearchOutcome> {
  return {
    name: "search_bangumi",
    label: "Fetch pilgrimage points for a work",
    description: DESCRIPTION,
    parameters: searchBangumiParameters,
    execute: (_toolCallId, params, signal) =>
      degradingCatalogFailure("search_bangumi", () => UPSTREAM_DOWN, (deadline) =>
        searchWork(catalog, session, params.bangumi_id, deadline), budget, signal),
  };
}
