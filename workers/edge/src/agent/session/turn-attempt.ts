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
import type { SelectionRequest } from "../selection/selection-request.ts";
import type { LoadedTurn } from "./turn-store.ts";
import type { TurnMemory } from "../memory/session-memory.ts";
import { recordTurnFacts } from "../memory/turn-fact-recorder.ts";
import { createTurnAgent } from "./turn-agent.ts";
import { rehydrateRefs, type MintedRefs } from "./minted-refs.ts";
import { resumedTranscript, type ResumedTranscript } from "./turn-transcript.ts";
import { UNANSWERED_TURN, type TurnAnswer, type TurnAnswering } from "./turn-answer.ts";
import { ProviderFailure, type RunMachine } from "./run-machine.ts";
import type { SecretScrub } from "../egress/secret-scrub.ts";
import { TurnOutput } from "./turn-output.ts";
import { TurnSteps } from "./turn-step.ts";
import type { TurnFrameSink } from "./turn-subscribers.ts";
import type { Toolbox } from "./turn-toolbox.ts";
import type { TurnModel } from "./turn-model.ts";
import type { TurnUsage } from "../settlement/turn-settlement.ts";
import type { TurnStore } from "./turn-store.ts";

export interface TurnAttemptParts {
  readonly store: TurnStore;
  /**
   * What this turn runs on: the registry, the model, and — for a BYOK turn
   * (#1289) — the guarded fetch and the scrub seeded with the caller's key.
   *
   * `null` when this deployment could resolve none. Only a DETERMINISTIC
   * selection can still be driven then (#1288): it answers from the catalog
   * and never reaches a provider. `DurableTurn` fails every OTHER modelless
   * run before the attempt is driven, which is why the narrowing below is an
   * invariant stated rather than a branch anyone takes.
   */
  readonly model: TurnModel | null;
  readonly toolbox: Toolbox;
  readonly systemPrompt: string;
  /** How this turn answers: the `respond` tool, and the typed output its call
   * becomes (#1283). */
  readonly answering: TurnAnswering;
  /** What this session remembers (#1290): the fact ledger compaction rescues
   * entities into, and the recorder appends this turn's facts to. */
  readonly memory: TurnMemory;
  /** The refs this RUN minted (#1279): where a settled step reports the ones
   * it added, and where a retry puts the earlier attempts' back. */
  readonly refs: MintedRefs;
  /** How a DETERMINISTIC selection turn is answered (#1288), or null when this
   * deployment cannot answer one — the catalog binding it needs is the same
   * one `turnToolbox` needs, and an environment without it has no tools either. */
  readonly selection: SelectionTurn | null;
  readonly emit: TurnFrameSink;
  readonly owner: string;
  readonly now: () => number;
}

/**
/** The model a MODEL turn runs on. `DurableTurn` refuses a modelless run that
 * is not a selection before this point, so the throw states that invariant
 * rather than guarding a path a caller can reach. */
function modelFor(model: TurnModel | null): TurnModel {
  if (model === null) throw new ProviderFailure("this deployment resolved no model for this turn");
  return model;
}

/** A turn driven without a model resumes nothing: only a DETERMINISTIC
 * selection is (#1288), it has no history to re-clothe, and its one step is
 * numbered from zero. */
const UNRESUMED: ResumedTranscript = { messages: [], settledSteps: 0 };

function resumedFor(turn: LoadedTurn, model: TurnModel | null): ResumedTranscript {
  return model === null ? UNRESUMED : resumedTranscript(turn, model.model);
}

/**
 * A selection turn, as the attempt reaches it (#1288).
 *
 * A function rather than the whole of `src/agent/selection/`: everything that
 * path needs beyond the run's own steps — the catalog, the session's registry,
 * the frame sink — is deployment configuration `session-turn.ts` already owns,
 * and the loop has no business assembling it a second time.
 */
export type SelectionTurn = (request: SelectionRequest, steps: TurnSteps) => Promise<TurnAnswer>;

/**
 * A pi run that ended carrying an error is a provider failure, not an answer.
 *
 * The message is SCRUBBED on the way in, not wherever it is next read: a BYOK
 * provider that echoes the caller's key back in its 401 body puts that key in
 * `state.errorMessage`, and this is the one place that string becomes a value
 * of ours. Scrubbing here means no later reader — a log line, an exception's
 * `cause`, a future span attribute — can carry the key without a second
 * decision being taken about it (#1289, spec §四 S5's "日志脱敏").
 */
function providerFailureIn(errorMessage: string | undefined, scrub: SecretScrub | undefined): ProviderFailure | null {
  if (errorMessage === undefined) return null;
  return new ProviderFailure(scrub === undefined ? errorMessage : scrub.text(errorMessage));
}

export class TurnAttempt {
  readonly output = new TurnOutput();
  readonly steps: TurnSteps;
  #answer: TurnAnswer = UNANSWERED_TURN;
  readonly #parts: TurnAttemptParts;
  readonly #turn: LoadedTurn;
  readonly #machine: RunMachine;
  readonly #resumed: ResumedTranscript;

  constructor(turn: LoadedTurn, machine: RunMachine, parts: TurnAttemptParts) {
    this.#turn = turn;
    this.#machine = machine;
    this.#parts = parts;
    this.#resumed = resumedFor(turn, parts.model);
    const { store, owner, now, refs } = parts;
    const resumedSteps = this.#resumed.settledSteps;
    this.steps = new TurnSteps({ store, turn, output: this.output, machine, refs, resumedSteps, owner, now });
  }

  /** What this attempt answered, once its pi run has ended. */
  get answer(): TurnAnswer {
    return this.#answer;
  }

  /**
   * What this attempt's TOOLS spent on model calls the pi run never made
   * (#1292) — the tool-less translation, whose `message_end` `output` cannot
   * see. Read off the toolbox rather than accumulated here: the toolbox made
   * the call, and a replayed step is answered from `run_steps.result` without
   * calling `execute`, so an attempt that replays every step reports nothing
   * and the ending banks nothing twice.
   */
  get spent(): TurnUsage {
    return this.#parts.toolbox.spent();
  }

  /**
   * One attempt at answering the turn.
   *
   * The facts are recorded from the attempt's own steps AFTER whichever path
   * ran and BEFORE the ending, which is where Python recorded them
   * (`_execution_result`, command-then-query) and the only place they can go:
   * the settlement stages the envelope, so a fact written after it would be
   * staged by nobody and the retry would promote a ledger missing it. It sits
   * on BOTH paths because a `plan_selected` pick is where Python's scene
   * references came from in the first place (#1288 × #1290) — a turn that
   * throws records nothing either way, since the throw leaves before this line.
   *
   * THE REFS COME BACK FIRST (#1279). A settled step is replayed from
   * `run_steps.result` without calling `execute`, so the registry the tools
   * mint through is empty on a retry unless it is rebuilt — and a `plan_route`
   * naming a ref an earlier attempt minted would answer `stale_ref` instead of
   * planning. It is one line here rather than inside `TurnSteps` because it is
   * about the whole run rather than about one step, and it has to be done
   * before the FIRST step of either path.
   *
   * A submission that carried a selection never reaches a model — Python routed
   * one straight to its handler and so does this (`_kind_from_request`) — so
   * the branch is here rather than inside the loop: a selection has no
   * transcript to continue, no tools to offer and no usage to meter, and every
   * one of those would have to be defended against inside the pi path.
   */
  async drive(): Promise<void> {
    rehydrateRefs(this.#parts.refs, this.#turn.steps);
    const request = this.#turn.selection;
    if (request === null) await this.#modelled(modelFor(this.#parts.model));
    else await this.#select(request);
    recordTurnFacts(this.#parts.memory, this.steps.recorded, new Date(this.#parts.now()));
  }

  /** The deterministic path: one step, one answer, no provider call. */
  async #select(request: SelectionRequest): Promise<void> {
    const { selection } = this.#parts;
    if (selection === null) throw new Error("a selection turn needs the CATALOG binding");
    this.#answer = await selection(request, this.steps);
    if (this.steps.broken !== null) throw this.steps.broken;
  }

  /** One pi run. A run that ends carrying an error message never answered. */
  async #modelled(model: TurnModel): Promise<void> {
    const agent = createTurnAgent(this.#agentParts(model));
    await agent.continue();
    if (this.steps.broken !== null) throw this.steps.broken;
    const failure = providerFailureIn(agent.state.errorMessage, model.scrub);
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
  #agentParts(model: TurnModel) {
    const { systemPrompt, toolbox, emit, answering, memory } = this.#parts;
    const tools = [...this.steps.wrap(toolbox.tools()), answering.tool()];
    const shouldStop = () => this.#stops();
    const messages = this.#resumed.messages;
    return { model, systemPrompt, messages, tools, memory, output: this.output, emit, shouldStop };
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
