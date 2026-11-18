import { annotateExecution } from "./execution-witness.ts";
import type { AgentHarness, HookInvocation } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import type { PilgrimageToolContext } from "./tool-context.ts";
import { annotateToolContext, applyFrozenSummaries } from "./frozen-tool-summary.ts";
import { agentStatusMessage } from "./agent-status.ts";
import { renderWebResults } from "./rendered-web-results.ts";

/**
 * Register native hooks once on the concrete production harness. Web results render in a context handler
 * of their own, registered last: the SDK carries its messages past a handler that throws, so they render
 * even when the status cannot be built, and no handler registered here runs after them.
 */
export function installContextHooks(harness: AgentHarness<PilgrimageToolContext>, session: Session) {
  harness.hooks.on("after_tool", annotateToolContext);
  harness.hooks.on("after_tool", annotateExecution);
  harness.hooks.on("transform_context", (event, context) => contextWithStatus(session, event, context));
  harness.hooks.on("transform_context", ({ messages }) => ({ messages: renderWebResults(messages) }));
}

/** Prior-turn frozen summaries, then one fresh agent status from the branch's entries. */
async function contextWithStatus(session: Session, { messages, lane }: HookInvocation<"transform_context">, context: Context) {
  const branch = await session.branch(lane, context);
  if (!branch) throw new Error("The native context branch is missing");
  const entries = await branch.findEntries(undefined, context);
  return { messages: [...applyFrozenSummaries(messages), agentStatusMessage(entries)] };
}
