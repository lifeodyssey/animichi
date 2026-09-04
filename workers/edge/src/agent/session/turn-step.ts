/**
 * One tool step of one run (card #1252), ported from the W0-S4 spike's
 * `turn-step.ts`.
 *
 * This is where the spec's idempotency contract lives (§三 "工具步骤幂等"): a
 * step either REPLAYS the `run_steps` row that already carries a result, or it
 * executes the tool and writes `(run_id, step_index)` down BEFORE the loop is
 * allowed to continue. `DurableTurn` owns the sequence and the turn's endings;
 * this owns what happens inside one step.
 *
 * `step_index` is assigned by a counter on this object rather than read off the
 * transcript, and the turn runs pi with `toolExecution: "sequential"` so the
 * counter is deterministic: the k-th tool call of the run is step k on the first
 * attempt and on every retry, which is exactly what makes the key an
 * idempotency key rather than a log line.
 *
 * The assistant message that ISSUED the call rides the same transaction as the
 * first step it opens (spec Appendix C: "assistant 的 tool-call 消息必须与
 * `run_steps` 一起持久化并从转录重放"). Writing them together is what makes the
 * crash branch safe in both directions — a persisted step always has the message
 * that explains it, and a persisted message always has at least its first
 * answer, so `resumedTranscript` never rebuilds a transcript that ends on an
 * unanswered call.
 *
 * IT ALSO KEEPS THE RUN'S STEP LIST, for the fact recorder (#1290). Python
 * derived its ledger facts from `AgentResult.steps`, and the equivalent list
 * here has to include the REPLAYED steps as well as the newly executed ones —
 * a retry that re-derived facts from only what it executed itself would forget
 * the pacing an earlier attempt was asked for. Every step passes through
 * `#resolve` on every attempt, replayed or not, so this is the one place that
 * sees the whole run.
 *
 * A lost lease is NOT a tool failure. pi turns a tool's throw into an error
 * result the model reacts to, so throwing here would let a turn this
 * incarnation no longer owns carry on talking. The persistence transaction
 * renews the lease as its first statement instead: when that compare-and-set
 * finds another owner, nothing is written, the step is marked abandoned and
 * `DurableTurn` stops the loop without settling anything.
 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@earendil-works/pi-ai";
import type { RecordedStep } from "../memory/turn-fact-recorder.ts";
import type { MintedRefs, StepMint } from "./minted-refs.ts";
import { TurnStoreUnavailable, type RunMachine } from "./run-machine.ts";
import type { TurnOutput } from "./turn-output.ts";
import type { TurnTool } from "./turn-toolbox.ts";
import { StepSequence } from "./turn-step-sequence.ts";
import {
  asJsonValue,
  type LoadedTurn,
  type SettledStep,
  type StepResult,
  type ToolCallEnvelope,
  type TurnStore,
} from "./turn-store.ts";

export interface TurnStepParts {
  readonly store: TurnStore;
  readonly turn: LoadedTurn;
  readonly output: TurnOutput;
  readonly machine: RunMachine;
  /** The run's ref registry, which every settled step reports back to (#1279). */
  readonly refs: MintedRefs;
  /** How many of this run's settled steps the resumed transcript already
   * answers — where this attempt's numbering starts (#1279). */
  readonly resumedSteps: number;
  /** The Durable Object incarnation holding this run's single-writer lease. */
  readonly owner: string;
  readonly now: () => number;
}

function toolResultOf(result: StepResult): AgentToolResult<JsonValue> {
  return { content: result.content, details: result.details };
}

/** One executed tool call: what it was asked, what it answered, and the refs
 * it minted while answering. */
interface ToolCall {
  readonly input: JsonValue;
  readonly result: AgentToolResult<JsonValue>;
  readonly minted: readonly StepMint[];
}

/** One executed call as `run_steps` stores it, with the assistant message it
 * opens when it is the first step of that assistant turn, and the refs it
 * minted (#1279). */
function settledStep(
  stepIndex: number,
  toolName: string,
  call: ToolCall,
  opening: ToolCallEnvelope | null,
): SettledStep {
  const { content, details } = call.result;
  const result = { content, details, minted: call.minted };
  return { stepIndex, toolName, input: call.input, result, toolCallMessage: opening };
}

export class TurnSteps {
  /** Every step of this RUN, replayed ones included, in settlement order. */
  readonly recorded: RecordedStep[] = [];
  readonly #parts: TurnStepParts;
  readonly #sequence: StepSequence;
  #abandoned = false;
  #broken: TurnStoreUnavailable | null = null;

  constructor(parts: TurnStepParts) {
    this.#parts = parts;
    this.#sequence = new StepSequence(parts.turn, parts.resumedSteps);
  }

  /** True once a persistence transaction found the lease in another owner's hands. */
  get abandoned(): boolean {
    return this.#abandoned;
  }

  /**
   * The store failure that ended this turn, if one did. It is kept rather than
   * thrown because pi catches a tool's throw and hands the model an error
   * result — a turn whose steps can no longer be written must stop, not carry
   * on talking about the failure.
   */
  get broken(): TurnStoreUnavailable | null {
    return this.#broken;
  }

  /** The toolbox's tools, each one numbered, replayable and persisted. */
  wrap(tools: readonly TurnTool[]): TurnTool[] {
    return tools.map((tool) => ({
      ...tool,
      execute: (id, params, signal, onUpdate) => this.#resolve(tool, id, params, signal, onUpdate),
    }));
  }

  /**
   * One SERVER-initiated step: the same `(run_id, step_index)` contract, for
   * work no model asked for (card #1288's selections).
   *
   * The seam exists because the idempotency key is the TURN's, not the model
   * loop's — spec §三 names route persistence, a side effect the model never
   * requests, as the example the key is for. A deterministic selection is
   * exactly that turn: it calls the catalog, stores an itinerary and answers,
   * with no provider call anywhere in it, and it must survive an eviction on
   * the same terms as a tool call does.
   *
   * `execute` must ANSWER its own failures rather than throw them, the way the
   * catalog tools do: a settled step is what a retry replays, so a failure that
   * escaped would be retried against a catalog that already answered.
   */
  take(
    toolName: string,
    input: JsonValue,
    execute: () => Promise<AgentToolResult<JsonValue>>,
  ): Promise<AgentToolResult<JsonValue>> {
    return this.#numbered(toolName, asJsonValue(input), execute);
  }

  async #resolve(
    tool: TurnTool,
    ...call: Parameters<TurnTool["execute"]>
  ): Promise<AgentToolResult<JsonValue>> {
    return this.#numbered(tool.name, asJsonValue(call[1]), () => tool.execute(...call));
  }

  /**
   * Replay the settled result under the next index, or execute and settle it —
   * and remember either one for the fact recorder (#1290).
   *
   * The recording sits here, below the two entry points, so a SERVER-initiated
   * step is a fact-bearing step on the same terms as a model's tool call: a
   * `plan_selected` pick leaves a scene reference in the ledger exactly as a
   * model-issued `plan_route` does, and neither caller has to remember to say so.
   */
  async #numbered(
    toolName: string,
    input: JsonValue,
    execute: () => Promise<AgentToolResult<JsonValue>>,
  ): Promise<AgentToolResult<JsonValue>> {
    const stepIndex = this.#sequence.take();
    const settled = this.#sequence.settled(stepIndex);
    if (settled !== null) return this.#recorded(toolName, input, toolResultOf(settled));
    const { refs, output } = this.#parts;
    const mark = refs.mintCount;
    const result = await execute();
    const opening = this.#sequence.opening(stepIndex, output.assistantMessage);
    const minted = refs.mintedSince(mark);
    await this.#settle(settledStep(stepIndex, toolName, { input, result, minted }, opening));
    return this.#recorded(toolName, input, result);
  }

  /** Remember what the run asked and what it got, for the fact recorder. */
  #recorded(
    toolName: string, input: JsonValue, result: AgentToolResult<JsonValue>,
  ): AgentToolResult<JsonValue> {
    this.recorded.push({ toolName, input, details: result.details });
    return result;
  }

  /** Write the step down before the loop continues. A store that refuses the
   * write ends the turn without settling it; a lost lease abandons it. */
  async #settle(step: SettledStep): Promise<void> {
    const { store, turn, owner, machine, now } = this.#parts;
    try {
      const held = await store.persistStep(turn, owner, step, machine.leaseUntil(), new Date(now()));
      this.#abandoned = this.#abandoned || !held;
    } catch (error) {
      this.#broken ??= new TurnStoreUnavailable(error);
    }
  }
}
