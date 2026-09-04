/**
 * The public-web read the `web_search` tool performs, as a port.
 *
 * Port of `apps/agent`'s `RuntimeDeps.web_searcher` (`runtime_deps.py`), which
 * existed for exactly this reason: the tool's behaviour — the ten-second
 * budget, the top-five cut, the untrusted wrapping — is ours, and the backend
 * that answers is a detail behind one function type. Python defaulted to
 * `ddgs`; `workers/edge` defaults to `duckduckgo-web-searcher.ts`, and the
 * owner can swap a keyed API in without touching the tool or its tests.
 *
 * Note what this port does NOT carry: a URL, a key, or a fetch. Everything
 * that leaves this Worker leaves through `src/agent/egress/` (spec Appendix D),
 * so an adapter is handed its guarded fetch rather than reaching for one.
 */

/** One web search result, before it is rendered into the agent's context. */
export interface WebResult {
  readonly title: string;
  readonly body: string;
  readonly href: string;
}

/**
 * The search itself: a query in, the backend's own ranking out.
 *
 * It returns whatever the backend gave, unsanitised and untruncated — the tool
 * is what cuts the list to five and wraps each field, so an adapter cannot
 * accidentally become a second, weaker copy of that boundary.
 */
export type WebSearcher = (query: string, signal?: AbortSignal) => Promise<readonly WebResult[]>;

/**
 * The backend could not answer. Python degraded `(TimeoutError, OSError,
 * RuntimeError, httpx.HTTPError, DDGSException)` into one readable sentence
 * (`web_tools.py::_SEARCH_ERRORS`); this is that set, named, so an adapter says
 * "the search failed" in a type rather than by leaking its own client's
 * exception vocabulary into the tool.
 */
export class WebSearchUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "WebSearchUnavailableError";
  }
}
