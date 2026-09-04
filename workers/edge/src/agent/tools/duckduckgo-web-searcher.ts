/**
 * The `WebSearcher` this deployment ships with: DuckDuckGo's HTML endpoint,
 * through the egress guard.
 *
 * DECISION (#1287), and it is a decision the owner can revisit behind the port
 * without touching the tool. Python searched through `ddgs`, the scraping
 * client `pydantic_ai.common_tools.duckduckgo` wraps; that library is Python
 * and does its own HTTP, so neither the client nor its transport could come
 * along. The two candidates were this endpoint and a keyed API (Brave, Tavily,
 * SerpAPI). This one wins on three counts:
 *   - it queries the same upstream index Python did, so the tool's answers stay
 *     comparable to the eval trajectories rather than becoming a new baseline;
 *   - it needs no secret, so the tool WORKS on the existing staging deploy —
 *     a keyed adapter would ship dark until an owner provisions a key across
 *     `wrangler.toml` ×3, `src/env.ts` and the docs, and the (api) evidence
 *     this card owes could not be produced;
 *   - the response is parseable and it is measured, not assumed
 *     (`duckduckgo-result-page.ts`).
 * What it costs: somebody else's markup is load-bearing. That is contained —
 * the parse is pure and fixture-tested, a shape change degrades to "no results
 * found" rather than to wrong ones, and swapping in a keyed adapter is one new
 * file behind `WebSearcher`.
 *
 * The `User-Agent` is REQUIRED, not decoration: measured 2026-09-04, the same
 * request without one is answered `202` with no result markup at all, which
 * would read to this adapter as an empty index.
 *
 * Everything leaves through `webSearchFetch` (spec Appendix D). This module
 * never calls `globalThis.fetch`, so there is no path from here to the internet
 * that skips the host allowlist or the redirect re-validation.
 */

import type { EgressFetch } from "../egress/guarded-fetch.ts";
import { WEB_SEARCH_HOST } from "../egress/web-search-egress.ts";
import { duckduckgoResults } from "./duckduckgo-result-page.ts";
import { WebSearchUnavailableError, type WebResult, type WebSearcher } from "./web-searcher.ts";

/** The endpoint the results are read from. Its host is the allowlisted one. */
export const DUCKDUCKGO_SEARCH_URL = `https://${WEB_SEARCH_HOST}/html/`;

/**
 * Identifies us, and is what makes the endpoint answer with results at all.
 * A contactable name rather than a browser's string: we are a bot, we say so.
 */
const USER_AGENT = "animichi-agent/1.0 (+https://animichi.com)";

/** The query as one URL; `URLSearchParams` owns the encoding. */
function searchUrl(query: string): string {
  const url = new URL(DUCKDUCKGO_SEARCH_URL);
  url.searchParams.set("q", query);
  return url.toString();
}

/**
 * The page's own text, or a failure the tool can degrade into.
 *
 * `200`, not `response.ok`. The measured anti-bot answer is `202` with no
 * result markup in it (that is what a request with no `User-Agent` gets), and
 * `ok` is true for it — so an `ok` check would read a refusal as an index with
 * nothing in it and tell the user "No results found".
 */
async function pageText(response: Response): Promise<string> {
  if (response.status !== 200) {
    throw new WebSearchUnavailableError(`search backend answered ${String(response.status)}`);
  }
  return await response.text();
}

/** Search DuckDuckGo through `fetch`, and read the page it answers with. */
async function search(
  fetch: EgressFetch,
  query: string,
  signal?: AbortSignal,
): Promise<readonly WebResult[]> {
  const response = await fetch(searchUrl(query), {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal,
  });
  return duckduckgoResults(await pageText(response));
}

/** The searcher, bound to the guarded fetch it is allowed to leave through. */
export function duckduckgoWebSearcher(fetch: EgressFetch): WebSearcher {
  return (query, signal) => search(fetch, query, signal);
}
