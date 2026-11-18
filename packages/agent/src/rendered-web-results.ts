import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { z } from "zod";
import { ExecutionWitness } from "./execution-witness.ts";
import { NO_RESULTS, recordedResult, untrustedWebText } from "./web-search-results.ts";
import { SOURCE_TIERS } from "./web-source-tier.ts";

/**
 * Stored `web_search` details: the recorded results, and the witness the native runtime stores with every
 * result, whose arguments are the query the search ran. Nothing else parses.
 */
const StoredWebSearch = z.strictObject({
  results: z.array(z.strictObject({ title: z.string(), body: z.string(), href: z.string(), source_tier: z.enum(SOURCE_TIERS) })),
  execution: z.strictObject({ ...ExecutionWitness.shape, args: z.strictObject({ query: z.string() }) }),
});

/** The model's text for a stored result whose details do not parse; none of the stored text is in it. */
const WITHHELD = "The stored web search results could not be read and are withheld. Search again if they are still needed.";

/**
 * Gives every successful `web_search` result the text the current code renders from its recorded details,
 * whichever turn or session stored it: results through the current field escaping and wrapper, and a
 * search that found nothing as the no-results text around the query its witness recorded, exactly as the
 * tool writes both. A result recorded under an earlier escaping reaches the model escaped, one the current
 * code wrote is unchanged byte for byte, and no stored result text passes. Stored text is never re-escaped:
 * in flat text the wrapper's own tags and a tag inside a field look the same.
 *
 * Fails closed: details that do not parse, including details without the witness or its string query,
 * give the fixed WITHHELD text. A text keeps the tool call answered, which dropping the message would not,
 * and throwing would let the stored text through, since the SDK reports a failing context handler and
 * carries on with the messages it had.
 *
 * Error results pass unchanged: their text is the tool's own error message, never result text.
 */
export function renderWebResults(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => message.role === "toolResult" && message.toolName === "web_search" && !message.isError ? withRenderedText(message) : message);
}

function withRenderedText(message: ToolResultMessage): ToolResultMessage {
  return { ...message, content: [{ type: "text", text: renderedText(message.details) }] };
}

function renderedText(stored: unknown): string {
  const details = StoredWebSearch.safeParse(stored);
  if (!details.success) return WITHHELD;
  const { results, execution } = details.data;
  return results.length > 0 ? untrustedWebText(results.map(recordedResult)) : `${NO_RESULTS}${execution.args.query}`;
}
