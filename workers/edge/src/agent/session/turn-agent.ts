/**
 * The pi Agent one alarm drives (card #1252).
 *
 * Assembly only — every decision it encodes is argued somewhere else — but four
 * of them have to be made together, so they are made here:
 *
 * - **`continue()`, not `prompt()`.** The transcript is seeded from Neon by
 *   `seededMessages`, and it always ends on a user message or a tool result,
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
 * - **one subscription feeds both the ledger and the wire.** The same listener
 *   records what the turn produced (`TurnOutput`) and pushes SD-9 frames, in
 *   that order: the assistant message must be recorded before the tool call it
 *   issued executes, because `TurnSteps` persists the two together.
 */
import { Agent, type AgentOptions } from "@earendil-works/pi-agent-core";
import { seededMessages } from "./turn-transcript.ts";
import { framesFor } from "./turn-frames.ts";
import type { TurnFrameSink } from "./turn-subscribers.ts";
import type { TurnOutput } from "./turn-output.ts";
import type { TurnTool } from "./turn-toolbox.ts";
import type { LoadedTurn } from "./turn-store.ts";
import { streamOptionsFor, type TurnModel } from "./turn-model.ts";

export interface TurnAgentParts {
  /** The registry, the model and the fetch its requests go out through. */
  readonly model: TurnModel;
  readonly systemPrompt: string;
  readonly turn: LoadedTurn;
  readonly tools: readonly TurnTool[];
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

function agentOptions(parts: TurnAgentParts): AgentOptions {
  const { registry, model } = parts.model;
  return {
    initialState: {
      systemPrompt: parts.systemPrompt,
      model,
      tools: [...parts.tools],
      messages: seededMessages(parts.turn, model),
    },
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
