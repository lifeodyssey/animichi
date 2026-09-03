/**
 * One attempt at one turn (card #1252).
 *
 * A turn can be attempted more than once — an eviction, an uncaught exception
 * in `alarm()`, a sweep that re-armed a stranded run — and everything that is
 * per-ATTEMPT rather than per-run belongs together: the state machine reading
 * this attempt's clock, what this attempt's model calls produced, and the step
 * numbering it resolves against what earlier attempts already settled.
 *
 * `DurableTurn` owns the run — winning its lease and writing its ending — and
 * hands one of these the middle. Without the split those four values travel as
 * a clump through every method of the loop.
 */
import type { LoadedTurn } from "./turn-store.ts";
import { createTurnAgent } from "./turn-agent.ts";
import { UNANSWERED_TURN, type TurnAnswer, type TurnAnswering } from "./turn-answer.ts";
import { ProviderFailure, type RunMachine } from "./run-machine.ts";
import { TurnOutput } from "./turn-output.ts";
import { TurnSteps } from "./turn-step.ts";
import type { TurnFrameSink } from "./turn-subscribers.ts";
import type { Toolbox } from "./turn-toolbox.ts";
import type { MutableModels } from "@earendil-works/pi-ai";
import type { TurnStore } from "./turn-store.ts";

export interface TurnAttemptParts {
  readonly store: TurnStore;
  readonly models: MutableModels;
  readonly toolbox: Toolbox;
  readonly systemPrompt: string;
  /** How this turn answers: the `respond` tool, and the typed output its call
   * becomes (#1283). */
  readonly answering: TurnAnswering;
  readonly emit: TurnFrameSink;
  readonly owner: string;
  readonly now: () => number;
}

/** A pi run that ended carrying an error is a provider failure, not an answer. */
function providerFailureIn(errorMessage: string | undefined): ProviderFailure | null {
  return errorMessage === undefined ? null : new ProviderFailure(errorMessage);
}

export class TurnAttempt {
  readonly output = new TurnOutput();
  readonly steps: TurnSteps;
  #answer: TurnAnswer = UNANSWERED_TURN;
  readonly #parts: TurnAttemptParts;
  readonly #turn: LoadedTurn;
  readonly #machine: RunMachine;

  constructor(turn: LoadedTurn, machine: RunMachine, parts: TurnAttemptParts) {
    this.#turn = turn;
    this.#machine = machine;
    this.#parts = parts;
    const { store, owner, now } = parts;
    this.steps = new TurnSteps({ store, turn, output: this.output, machine, owner, now });
  }

  /** What this attempt answered, once its pi run has ended. */
  get answer(): TurnAnswer {
    return this.#answer;
  }

  /** One pi run. A run that ends carrying an error message never answered. */
  async drive(): Promise<void> {
    const agent = createTurnAgent(this.#agentParts());
    await agent.continue();
    if (this.steps.broken !== null) throw this.steps.broken;
    const failure = providerFailureIn(agent.state.errorMessage);
    if (failure !== null) throw failure;
    this.#answer = this.#parts.answering.close(this.output.answer);
  }

  /**
   * The catalog tools are numbered and persisted; `respond` is neither. A
   * replayed step is answered from `run_steps.result` WITHOUT calling `execute`
   * (`TurnSteps`), so a wrapped `respond` would leave the retry with a submitted
   * answer it never saw — and the answer is state of this attempt, not a tool
   * result the world is waiting on.
   */
  #agentParts() {
    const { models, systemPrompt, toolbox, emit, answering } = this.#parts;
    const tools = [...this.steps.wrap(toolbox.tools()), answering.tool()];
    const shouldStop = () => this.#stops();
    return { models, systemPrompt, turn: this.#turn, tools, output: this.output, emit, shouldStop };
  }

  /** Between turns: the answer, the budget, the lease and the store all get a
   * veto. A submitted answer is the loop's normal ending — spec §二's
   * "terminate" half of the structured-output pattern. */
  #stops(): boolean {
    if (this.#parts.answering.submitted) return true;
    if (this.steps.abandoned || this.steps.broken !== null) return true;
    return this.#machine.beginStep().phase !== "running";
  }
}
