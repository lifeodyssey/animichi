/**
 * What a catalog tool does when the catalog cannot answer.
 *
 * Port of `catalog_failures.py` × `catalog_tools.py::_log_upstream_down`: the
 * named failure set degrades into that tool's own "upstream" outcome, and the
 * upstream text is written to the server log ONLY (SD-19). Anything outside the
 * set — an abort above all — is re-thrown, because pi reads an abort as the
 * turn ending rather than as a tool result.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { CatalogUnavailableError } from "./catalog-client.ts";
import type { ToolBudget } from "./catalog-timeouts.ts";
import { outcomeToolResult } from "./outcome-tool-result.ts";

/** The upstream text kept for the server log, never for the model (SD-19). */
function failureDetail(error: unknown): string {
  return error instanceof CatalogUnavailableError ? error.detail : "the tool budget elapsed";
}

/** Record a degraded failure against the tool that degraded. */
function logCatalogFailure(tool: string, error: unknown): void {
  // Logged as an object, not a JSON string: Workers Logs only indexes fields
  // of structured entries, and filtering by tool is the entire point.
  console.warn({ event: "catalog_tool_upstream_down", tool, error: failureDetail(error) });
}

/** Is this failure the tool's to degrade, or the turn's to propagate? */
function degradable(error: unknown, spent: boolean, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  return spent || error instanceof CatalogUnavailableError;
}

/**
 * Run one tool's work under its budget, degrading a catalog outage into
 * `degraded()` and letting an aborted TURN propagate untouched.
 *
 * `degraded` is a thunk rather than a value because two of the four tools also
 * drop the pending clarification on the way down — Python expressed the same
 * thing as `_nearby_upstream_down(ctx)`, an outcome its own side effect
 * produces.
 */
export async function degradingCatalogFailure<Outcome>(
  tool: string,
  degraded: () => Outcome,
  run: (deadline: AbortSignal) => Promise<Outcome>,
  budget: ToolBudget,
  signal?: AbortSignal,
): Promise<AgentToolResult<Outcome>> {
  const deadline = budget(signal);
  try {
    return outcomeToolResult(await run(deadline));
  } catch (error) {
    if (!degradable(error, deadline.aborted, signal)) throw error;
    logCatalogFailure(tool, error);
    return outcomeToolResult(degraded());
  }
}
