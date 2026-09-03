/**
 * The `AgentToolResult` that carries one compact outcome back to the model.
 *
 * Python returned the pydantic outcome object and let pydantic-ai serialize it;
 * pi wants content parts, so the outcome is the text the model reads AND the
 * `details` the DO persists and the SSE frames are built from. One value, two
 * readers — never two encodings that can disagree.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";

/** Wrap one outcome as the tool result pi expects. */
export function outcomeToolResult<Outcome>(outcome: Outcome): AgentToolResult<Outcome> {
  return { content: [{ type: "text", text: JSON.stringify(outcome) }], details: outcome };
}
