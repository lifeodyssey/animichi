/**
 * One turn, assembled from the Worker environment (card #1252).
 *
 * `AgentSession` owns two things — the requests it answers and the queue its
 * alarm drains — and this owns the third: what a queued run id is actually
 * turned into. They are separate because the assembly is where the deployment's
 * configuration enters (the provider key, the prices, the tools), and none of
 * that has anything to do with routing a request or keeping a queue.
 */
import { withAgentDatabase } from "../../db/agent-database.ts";
import { usagePricesIn } from "../settlement/turn-settlement.ts";
import { DurableTurn } from "./durable-turn.ts";
import { NeonTurnStore } from "./neon-turn-store.ts";
import { TURN_SYSTEM_PROMPT } from "./turn-instructions.ts";
import { createTurnModels, mimoKeyIn } from "./turn-model.ts";
import type { TurnFrameSink } from "./turn-subscribers.ts";
import { EMPTY_TOOLBOX, type Toolbox } from "./turn-toolbox.ts";
import type { TurnStore } from "./turn-store.ts";

/**
 * The tools a turn may call. `EMPTY_TOOLBOX` until card #1253 lands
 * `src/agent/tools/` and its registry — the loop is complete without them (a
 * turn with no tools is one model call and an answer), and wiring a guessed
 * registry now would be a second definition of #1253's contract.
 */
const TOOLBOX: Toolbox = EMPTY_TOOLBOX;

export interface SessionTurnParts {
  readonly env: Record<string, unknown>;
  readonly emit: TurnFrameSink;
  /** The Durable Object incarnation taking the run's single-writer lease. */
  readonly owner: string;
}

/**
 * A missing provider key ends the run rather than looping: the sweeper would
 * otherwise re-arm a turn that can never reach a model, forever.
 */
async function driveOn(parts: SessionTurnParts, store: TurnStore, runId: string): Promise<void> {
  const apiKey = mimoKeyIn(parts.env);
  if (apiKey === undefined) {
    await store.settleFailed(runId, "provider_failed", new Date());
    return;
  }
  await new DurableTurn({
    store,
    models: createTurnModels(apiKey),
    toolbox: TOOLBOX,
    systemPrompt: TURN_SYSTEM_PROMPT,
    prices: usagePricesIn(parts.env),
    emit: parts.emit,
    owner: parts.owner,
    now: Date.now,
  }).run(runId);
}

/** Run one queued turn on its own database connection, and close it after. */
export function driveQueuedRun(parts: SessionTurnParts, runId: string): Promise<void> {
  return withAgentDatabase(parts.env, (transactions) =>
    driveOn(parts, new NeonTurnStore(transactions), runId));
}
