/**
 * What one turn produced, accumulated from the pi Agent's own events (card
 * #1252).
 *
 * Three facts about a turn are only knowable while it runs, and all three are
 * needed after it ends, so they are collected in one place rather than dug back
 * out of `agent.state` at settlement time:
 * - the assistant message currently issuing tool calls, because `TurnStep` has
 *   to persist it ALONGSIDE the `run_steps` row (Appendix C);
 * - the answer text, which becomes the `messages` row the settlement writes;
 * - the token usage, which `settleSucceededTurn` banks into `daily_usage`.
 *
 * Usage is summed over the assistant messages of THIS run only. A resumed run
 * seeds the transcript with messages an earlier alarm already produced, and
 * those were never metered (their turn never settled) — but they are also not
 * this alarm's provider calls, and pi does not re-emit `message_end` for a
 * seeded message. Counting what this incarnation actually streamed is therefore
 * both what the events give and what the meter means; the whole-run figure is
 * whatever the settling alarm saw, which is the same rule the Python meter used
 * (`record_turn_usage` bills the run that produced a result).
 */
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { TurnUsage } from "../settlement/turn-settlement.ts";

function isAssistant(message: AgentMessage): message is AssistantMessage {
  return "role" in message && message.role === "assistant";
}

/** The words an assistant message says, with its tool calls left out. */
export function assistantTextOf(message: AssistantMessage): string {
  return message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export class TurnOutput {
  #assistant: AssistantMessage | null = null;
  #requests = 0;
  #inputTokens = 0;
  #outputTokens = 0;
  #answer = "";

  /** The assistant message issuing the calls being executed right now. */
  get assistantMessage(): AssistantMessage | null {
    return this.#assistant;
  }

  /** The text the turn answers with — the last assistant message that had any. */
  get answer(): string {
    return this.#answer;
  }

  get usage(): TurnUsage {
    return {
      requests: this.#requests,
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
    };
  }

  observe(event: AgentEvent): void {
    if (event.type !== "message_end" || !isAssistant(event.message)) return;
    this.#record(event.message);
  }

  #record(message: AssistantMessage): void {
    this.#assistant = message;
    this.#requests += 1;
    this.#inputTokens += message.usage.input;
    this.#outputTokens += message.usage.output;
    const text = assistantTextOf(message);
    if (text !== "") this.#answer = text;
  }
}
