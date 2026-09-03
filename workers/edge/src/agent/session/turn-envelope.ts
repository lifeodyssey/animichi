/**
 * The session envelope's part in one turn (card #1280).
 *
 * Two moments, and they belong together because the invariant between them is
 * the whole point: the turn OPENS with what earlier turns left — the tools are
 * seeded from it and the model is told about it — and CLOSES by writing back
 * what the tools left, once, and only if this incarnation is the one that
 * settled the run.
 *
 * That last condition is what makes a crash safe. `declined` and `abandoned`
 * settle nothing, because another owner is running the turn and owns its ending;
 * a `TurnStoreUnavailable` never returns a state at all, so a turn that could
 * not write its own step does not overwrite the envelope either, and the retry
 * finds the previous one intact and replays into it (spec Appendix C).
 *
 * What the turn wrote is settled per TURN and not per step, deliberately: a
 * replayed step is answered from `run_steps.result` without calling `execute`
 * (`TurnSteps`), so it applies nothing, and the value written back is the whole
 * envelope rather than a delta, so writing it twice cannot count twice.
 *
 * ONE PYTHON RULE IS NOT PORTED, and it is not an oversight. `animichi_runner`
 * cleared `pending_clarification` at the end of a successful run UNLESS the
 * model's final answer was itself a `ClarifyResponseModel` — a repair for a tool
 * that asked a question the model then never put to the user. It is not
 * expressible here yet: the TS tier has no typed output vocabulary (see
 * `turn-instructions.ts`), so `TurnState` carries nothing about WHAT the model
 * answered, only whether the run ended. Until the structured-output card lands,
 * the tools are the only witness — every one of them clears the clarification on
 * the paths that answer (`resolve_anime` resolved, both searches, `plan_route`)
 * and sets it on the paths that ask — and a clarification a tool set but the
 * model failed to voice will persist one turn too long.
 */
import type { SessionEnvelopeStore } from "./session-envelope.ts";
import type { TurnState } from "./run-machine.ts";
import { TurnCatalogSession, type TurnCatalogSessionParts } from "./turn-catalog-session.ts";
import { turnSystemPrompt } from "./turn-instructions.ts";

/**
 * Whether the run this turn was driving is over as far as this alarm can tell.
 *
 * Every phase but one qualifies, and the exclusion is the point. `abandoned`
 * means the lease was lost MID-turn: another incarnation took the run over and
 * will stage and promote its own answer, so promoting here would publish a
 * half-finished turn over theirs. `declined` DOES qualify, because it covers the
 * retry this whole mechanism exists for — an alarm that comes back to find the
 * run already terminal (`loadRunningTurn` answered null) and a staged envelope
 * waiting. It also covers losing the opening compare-and-set to a live owner,
 * where promoting is harmless: that owner stages only immediately before its own
 * settlement, so either there is nothing staged and this is a no-op, or the
 * value staged is the very one they are about to promote themselves.
 */
function runIsOver(state: TurnState): boolean {
  return state.phase !== "abandoned";
}

export class TurnEnvelope {
  /** The session state this turn's catalog tools read and write. */
  readonly session: TurnCatalogSession;
  /** The system prompt this turn opens with, carrying what the session knows. */
  readonly systemPrompt: string;
  readonly #envelopes: SessionEnvelopeStore;
  readonly #runId: string;

  constructor(envelopes: SessionEnvelopeStore, runId: string, parts: TurnCatalogSessionParts) {
    this.#envelopes = envelopes;
    this.#runId = runId;
    this.session = new TurnCatalogSession(parts);
    this.systemPrompt = turnSystemPrompt(this.session.envelope);
  }

  /** Load the session's envelope and seed one turn's tools and model from it. */
  static async open(
    envelopes: SessionEnvelopeStore,
    runId: string,
    locale: string,
  ): Promise<TurnEnvelope> {
    return new TurnEnvelope(envelopes, runId, { locale, envelope: await envelopes.load() });
  }

  /** Put what the tools left on disk, under this run's key, before the run's
   * terminal row lands. `EnvelopeStagingStore` is what calls it. */
  async stage(): Promise<void> {
    await this.#envelopes.stage(this.#runId, this.session.envelope);
  }

  /** Make the staged answer the session's, once the run is over. */
  async close(state: TurnState): Promise<void> {
    if (!runIsOver(state)) return;
    await this.#envelopes.promote(this.#runId);
  }
}
