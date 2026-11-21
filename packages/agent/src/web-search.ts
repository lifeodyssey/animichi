import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { bodyTextWithin } from "./bounded-body-text.ts";
import { authorizeInvocation, type PilgrimageToolContext } from "./tool-context.ts";
import { NO_RESULTS, webSearchResults, untrustedWebText } from "./web-search-results.ts";

const parameters = Type.Object({ query: Type.String({ pattern: "\\S", maxLength: 500 }) }, { additionalProperties: false });

/**
 * The most of a search response body `web_search` keeps: 256 KiB, counted in bytes as they arrive;
 * only a body that fits is parsed. The chunk that would pass the limit, already handed over by the
 * runtime, is neither decoded nor kept. Real pages need far less. The captured backend page in
 * `workers/edge/test/doubles/duckduckgo-result-markup.ts` holds three results in 3,643 bytes, the
 * largest 1,394, and the same 2026-09-04 measurement counted ten results a page (recorded in commit
 * 2f1102981): about 14 KB of results. The capture trimmed the rest of the page, so the limit leaves
 * eighteen times that. It is not higher because parsing builds the whole document: with this
 * package's htmlparser2 12.0.0, a page of nested tags built a 121 MB tree at 1 MiB, close to a
 * Worker's 128 MB, and a 30 MB one at 256 KiB.
 */
export const WEB_SEARCH_PAGE_MAX_BYTES = 262_144;

/** Public search is read-only and keyless; safe replay still rechecks authorization and quota. */
export const webSearch: AgentHarnessTool<PilgrimageToolContext, typeof parameters> = {
  name: "web_search", label: "Search the web", replay: "safe", parameters,
  description: "Search for attributed facts and accepted title translations. Never derive pilgrimage points or routes from web prose.",
  async execute(_id, params, _update, tools, invocation, context) {
    await authorizeInvocation(tools, invocation, context);
    const signal = AbortSignal.any([AbortSignal.timeout(10_000), ...(context.abortSignal ? [context.abortSignal] : [])]);
    const details = webSearchResults(await searchPage(params.query, tools.webFetch ?? globalThis.fetch, signal));
    return { content: [{ type: "text", text: details.length ? untrustedWebText(details) : `${NO_RESULTS}${params.query}` }], details: { results: details } };
  },
};

async function searchPage(query: string, fetch: typeof globalThis.fetch, signal: AbortSignal) {
  signal.throwIfAborted();
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetch(new Request(url, { signal, redirect: "manual", headers: { "User-Agent": "animichi-agent/1.0 (+https://animichi.com)", Accept: "text/html" } }));
  if (response.status !== 200) return rejectSearchResponse(response);
  return (await bodyTextWithin(response.body, WEB_SEARCH_PAGE_MAX_BYTES)) ?? searchUnavailable();
}

/** Releases a refused response's body, best effort, then fails as every upstream fault fails. */
async function rejectSearchResponse(response: Response): Promise<never> {
  await response.body?.cancel().catch(() => undefined);
  return searchUnavailable();
}

/** The one failure every upstream fault becomes: a refusal, a redirect, an unavailable backend or a page past the limit. */
function searchUnavailable(): never {
  throw new Error("Web search is temporarily unavailable");
}
