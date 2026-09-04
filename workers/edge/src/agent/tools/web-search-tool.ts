/**
 * `web_search` — the public web, for QA and title enrichment only.
 *
 * Port of `apps/agent/src/animichi/agents/web_tools.py::web_search`. The
 * description is that docstring, kept word-for-word because it is what the eval
 * trajectories and the system prompt describe, and the three answers are its
 * three answers: the wrapped results, `No results found for: …`, or
 * `Search failed for '…': …`.
 *
 * This is the agent's ONE untrusted inbound channel
 * (memory `project_indirect_injection_defense`), so two rules are absolute:
 * every result goes through `wrapUntrustedWebResults` before the model sees a
 * character of it, and the tool NEVER throws for a failure of its own — a
 * refused egress, a rate limit or a dead backend all become the failure
 * sentence, because a throw is a tool error the model reacts to instead of a
 * fact it reads.
 *
 * The ten-second budget is Python's `asyncio.wait_for(…, timeout=10.0)`, and it
 * is raced here rather than merely passed down: handing the searcher a signal
 * trusts the backend to observe it, and a backend that does not would hold the
 * turn for as long as it liked.
 */

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolBudget } from "./catalog-timeouts.ts";
import { wrapUntrustedWebResults } from "./web-result-trust.ts";
import { WebSearchUnavailableError, type WebResult, type WebSearcher } from "./web-searcher.ts";
import { webSearchParameters } from "./tool-schema-bridge.ts";

const DESCRIPTION = `Search the web for QA and title enrichment using DuckDuckGo.

Use this only when you need to:
- Find the correct translation of an anime title
- Verify a fact about an anime or an already-known location
- Find community-accepted translations from 萌娘百科 or Wikipedia

Do not use this tool to find pilgrimage locations or spots. Use the catalog tools search_nearby and search_bangumi for pilgrimage discovery.

Returns a text summary of the top search results.`;

/** How many of the backend's ranked results the model is shown. */
const MAX_RESULTS = 5;

/** One search, as Python budgeted it. */
export const WEB_SEARCH_TIMEOUT_MS = 10_000;

/**
 * The deadline one search runs under.
 *
 * Same shape as the catalog tools' `ToolBudget` and injectable for the same
 * reason: a test asserts the timeout with a budget that has already elapsed
 * rather than by waiting ten seconds for a real clock.
 */
export const webSearchBudget: ToolBudget = (signal) => {
  const own = AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, own]) : own;
};

/** Python's own failure sentence: readable, and carrying no URL of ours. */
function searchFailed(query: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : "the search failed";
  return `Search failed for '${query}': ${detail}`;
}

/** The deadline as a promise, so an unobservant backend cannot outlast it. */
function deadlinePassed(deadline: AbortSignal): Promise<never> {
  const elapsed = new WebSearchUnavailableError("the search timed out");
  return new Promise((_resolve, reject) => {
    if (deadline.aborted) {
      reject(elapsed);
      return;
    }
    deadline.addEventListener("abort", () => { reject(elapsed); }, { once: true });
  });
}

/** The results the model reads: at most five, each sanitised and delimited. */
function answered(query: string, results: readonly WebResult[]): string {
  if (results.length === 0) return `No results found for: ${query}`;
  return wrapUntrustedWebResults(results.slice(0, MAX_RESULTS));
}

/** The tool's answer is prose, so the text IS the detail the frames carry. */
function searchToolResult(text: string): AgentToolResult<string> {
  return { content: [{ type: "text", text }], details: text };
}

/** One search under its deadline, whichever finishes first. */
async function searched(
  searcher: WebSearcher,
  query: string,
  deadline: AbortSignal,
): Promise<readonly WebResult[]> {
  return await Promise.race([searcher(query, deadline), deadlinePassed(deadline)]);
}

/**
 * A failure of the SEARCH degrades; an aborted TURN propagates. Same rule the
 * catalog tools apply (`catalog-failure-degradation.ts`), for the same reason:
 * pi reads a throw as the turn ending rather than as a tool result.
 */
async function searchOutcome(
  searcher: WebSearcher,
  query: string,
  budget: ToolBudget,
  signal?: AbortSignal,
): Promise<string> {
  const deadline = budget(signal);
  try {
    return answered(query, await searched(searcher, query, deadline));
  } catch (error) {
    if (signal?.aborted === true) throw error;
    console.warn({ event: "web_search_failed", error: searchFailed(query, error) });
    return searchFailed(query, error);
  }
}

/** Build `web_search` over one searcher. */
export function webSearchTool(
  searcher: WebSearcher,
  budget: ToolBudget = webSearchBudget,
): AgentTool<typeof webSearchParameters, string> {
  return {
    name: "web_search",
    label: "Search the web",
    description: DESCRIPTION,
    parameters: webSearchParameters,
    execute: async (_toolCallId, params, signal) =>
      searchToolResult(await searchOutcome(searcher, params.query, budget, signal)),
  };
}
