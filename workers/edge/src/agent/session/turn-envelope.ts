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

/** What one turn needs to find, and later publish, its session's envelope. */
export interface TurnEnvelopeParts {
  readonly envelopes: SessionEnvelopeStore;
  /** The run this turn is driving. */
  readonly runId: string;
  /** Every run this session still owes work for, in the order its alarm drains
   * them — the order stale stagings are recovered in. */
  readonly queued: readonly string[];
  /** The language this turn's rows are rendered in. */
  readonly locale: string;
}
import type { TurnState } from "./run-machine.ts";
import { TurnCatalogSession, type TurnCatalogSessionParts } from "./turn-catalog-session.ts";
import { turnSystemPrompt } from "./turn-instructions.ts";

/**
 * Whether this alarm may publish what the run staged.
 *
 * Only the run's OWN terminal path qualifies. `succeeded` and `failed` are this
 * incarnation's own ending; `already_settled` is the retry of that ending, which
 * is the case the staging exists for — an alarm that came back to find the run
 * terminal and the answer still waiting under its key.
 *
 * `declined` does NOT qualify, and that is the correction #1282 asked for: it
 * means a LIVE owner holds the lease and is mid-turn. Promoting there would
 * publish a staging that owner wrote moments before its own Neon commit — and
 * if that commit then failed, this incarnation would have published an answer
 * for a run that never ended. `abandoned` does not qualify either: the owner
 * that took the run over settles it and promotes its own.
 */
function mayPromote(state: TurnState): boolean {
  if (state.phase === "already_settled") return true;
  return state.phase === "succeeded" || state.phase === "failed";
}

/**
 * Publish anything an earlier alarm settled but could not promote, BEFORE this
 * turn reads the session's envelope.
 *
 * Without this a stale staging outlives a newer answer (#1282): run-1 settles,
 * its promotion fails, so it stays queued while its `runs` row is terminal —
 * which lets admission open run-2. run-2 would read the OLD envelope, finish,
 * and promote its own; then run-1's retry would promote its stale staging over
 * the top. Draining first means run-2 starts from the recovered state and run-1's
 * retry finds nothing left to promote.
 *
 * The run this turn is about to drive is excluded on purpose. Its staging, if
 * any, belongs to whoever is settling it — possibly a live owner this
 * incarnation is about to lose the lease to — and `close()` publishes it on that
 * run's own terminal path. Every OTHER queued run that has a staging has already
 * reached its settlement, since nothing but a settlement stages, and admission
 * refuses a second running run per session; so none of them can still be in
 * flight. Queue order is the order the alarm drains runs in, so the newest
 * settlement is promoted last.
 */
async function recoverStagings(parts: TurnEnvelopeParts): Promise<void> {
  for (const staged of parts.queued) {
    if (staged !== parts.runId) await parts.envelopes.promote(staged);
  }
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

  /** Recover what earlier alarms left staged, then seed this turn from the
   * session's envelope — in that order, so the turn opens from the newest
   * state anyone actually settled. */
  static async open(parts: TurnEnvelopeParts): Promise<TurnEnvelope> {
    await recoverStagings(parts);
    const envelope = await parts.envelopes.load();
    return new TurnEnvelope(parts.envelopes, parts.runId, { locale: parts.locale, envelope });
  }

  /** Put what the tools left on disk, under this run's key, before the run's
   * terminal row lands. `EnvelopeStagingStore` is what calls it. */
  async stage(): Promise<void> {
    await this.#envelopes.stage(this.#runId, this.session.envelope);
  }

  /** Make the staged answer the session's, on the run's own terminal path. */
  async close(state: TurnState): Promise<void> {
    if (!mayPromote(state)) return;
    await this.#envelopes.promote(this.#runId);
  }
}
