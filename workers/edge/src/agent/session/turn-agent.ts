/**
 * The pi Agent one alarm drives (card #1252).
 *
 * Assembly only — every decision it encodes is argued somewhere else — but four
 * of them have to be made together, so they are made here:
 *
 * - **`continue()`, not `prompt()`.** The transcript is rebuilt from Neon by
 *   `resumedTranscript`, and it always ends on a user message or a tool result,
 *   which is exactly pi's precondition for continuing. One code path therefore
 *   serves both a fresh turn and a resumed one, and a resumed turn never asks
 *   the model to re-derive tool calls it already made (spec Appendix C).
 * - **`toolExecution: "sequential"`.** `step_index` is assigned by a counter as
 *   the tools execute (`TurnSteps`), so a parallel batch would number the same
 *   calls differently on a retry and break the `(run_id, step_index)` key. pi
 *   defaults to `"parallel"`; the idempotency contract does not allow it.
 * - **the deadline is a stop condition, not an exception.** `shouldStopAfterTurn`
 *   is pi's own seam for ending a loop between turns, so a turn that runs out of
 *   budget stops cleanly and settles `deadline_exceeded` instead of unwinding
 *   through a throw the model would never see.
 * - **`transformContext` is where the compaction TRIGGER hangs, and where the
 *   status bar is appended.** pi calls it on the way into every model request
 *   with the whole `AgentMessage[]`, and it is the seam AFTER
 *   `resumedTranscript` rebuilt the transcript from Neon, so what it shapes is
 *   the context and never the stored history. Since #1378 it shapes nothing at
 *   all under the trigger: a tool return's short form is frozen when the step is
 *   written, so the per-request pass is idempotent by construction
 *   (`context-compaction.ts`, `frozen-tool-return.ts`) and takes no memory,
 *   because nothing it does is a write. It is also the ONLY seam that can keep
 *   the `<agent_status>` bar last on every request (#1379): pi appends the
 *   assistant message and its tool results to `context.messages` as the turn
 *   runs, and a bar written into that list would sink under them and go stale,
 *   while what this function returns is used for one request and thrown away. So
 *   the bar is rendered fresh here, after compaction, from the envelope the
 *   tools have been rewriting — one bar per request, always the newest, never
 *   persisted.
 * - **one subscription feeds both the ledger and the wire.** The same listener
 *   records what the turn produced (`TurnOutput`) and pushes SD-9 frames, in
 *   that order: the assistant message must be recorded before the tool call it
 *   issued executes, because `TurnSteps` persists the two together.
 */
import { Agent, type AgentMessage, type AgentOptions } from "@earendil-works/pi-agent-core";
import { agentStatusMessages, type TurnStatus } from "./agent-status.ts";
import { contextCompaction } from "./context-compaction.ts";

import { framesFor } from "./turn-frames.ts";
import type { TurnFrameSink } from "./turn-subscribers.ts";
import type { TurnOutput } from "./turn-output.ts";
import type { TurnTool } from "./turn-toolbox.ts";
import { streamOptionsFor, type TurnModel } from "./turn-model.ts";

export interface TurnAgentParts {
  /** The registry, the model and the fetch its requests go out through. */
  readonly model: TurnModel;
  readonly systemPrompt: string;
  /** The transcript this run resumes from, rebuilt by `turn-transcript.ts`. */
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly TurnTool[];
  /** What the `<agent_status>` bar says on THIS request (#1379). A function
   * rather than a value: the tools rewrite the envelope and add tool calls as
   * the turn runs, and every request is entitled to the newest state. */
  readonly status: () => TurnStatus;
  readonly output: TurnOutput;
  readonly emit: TurnFrameSink;
  /** Asked between turns: true ends the loop (deadline, or a lost lease). */
  readonly shouldStop: () => boolean;
}

/**
 * Record what the turn produces, then show it. The order is the contract: the
 * assistant message has to be on the ledger before the tool call it issued
 * executes, because `TurnSteps` persists the two together.
 */
function recordAndStream(agent: Agent, output: TurnOutput, emit: TurnFrameSink): void {
  agent.subscribe(async (event) => {
    output.observe(event);
    await emit(framesFor(event));
  });
}

/**
 * The context one model request goes out with: the history the compaction pass
 * shaped, then the status bar as its LAST message.
 *
 * The order is the contract, in both directions. The bar has to be last for the
 * attention it is there to attract (#1379); and it is appended AFTER the pass
 * rather than handed to it, so a batch compaction can only ever see the stored
 * history — the bar is rebuilt per request and has nothing to shrink.
 */
function requestContext(parts: TurnAgentParts): (messages: AgentMessage[]) => Promise<AgentMessage[]> {
  const compacted = contextCompaction();
  return async (messages) => [...(await compacted(messages)), ...agentStatusMessages(parts.status())];
}

function agentOptions(parts: TurnAgentParts): AgentOptions {
  const { registry, model } = parts.model;
  return {
    initialState: {
      systemPrompt: parts.systemPrompt,
      model,
      tools: [...parts.tools],
      messages: [...parts.messages],
    },
    transformContext: requestContext(parts),
    streamFn: (target, context, options) =>
      registry.streamSimple(target, context, streamOptionsFor(parts.model, options)),
    shouldStopAfterTurn: () => parts.shouldStop(),
    toolExecution: "sequential",
  };
}

export function createTurnAgent(parts: TurnAgentParts): Agent {
  const agent = new Agent(agentOptions(parts));
  recordAndStream(agent, parts.output, parts.emit);
  return agent;
}
