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

/** The phases in which THIS incarnation wrote the run's terminal row. */
function settledHere(state: TurnState): boolean {
  return state.phase === "succeeded" || state.phase === "failed";
}

export class TurnEnvelope {
  /** The session state this turn's catalog tools read and write. */
  readonly session: TurnCatalogSession;
  /** The system prompt this turn opens with, carrying what the session knows. */
  readonly systemPrompt: string;
  readonly #envelopes: SessionEnvelopeStore;

  constructor(envelopes: SessionEnvelopeStore, parts: TurnCatalogSessionParts) {
    this.#envelopes = envelopes;
    this.session = new TurnCatalogSession(parts);
    this.systemPrompt = turnSystemPrompt(this.session.envelope);
  }

  /** Load the session's envelope and seed one turn's tools and model from it. */
  static async open(envelopes: SessionEnvelopeStore, locale: string): Promise<TurnEnvelope> {
    return new TurnEnvelope(envelopes, { locale, envelope: await envelopes.load() });
  }

  /** Bank what the tools left — with the run, and only if this turn settled it. */
  async close(state: TurnState): Promise<void> {
    if (!settledHere(state)) return;
    await this.#envelopes.save(this.session.envelope);
  }
}
