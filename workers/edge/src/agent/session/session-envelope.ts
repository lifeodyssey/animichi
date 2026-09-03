/**
 * What one session knows between its turns (card #1280, spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §三).
 *
 * Two facts have to outlive an alarm, and Python kept both in the session
 * envelope (`apps/agent/src/animichi/agents/session_state.py::SessionState`):
 * the clarification a tool asked for and could not answer itself, and the anime
 * the session is currently about. The NEXT turn is what needs them — a user
 * replying "the second one" is answering a question the previous alarm asked,
 * and a session that already resolved its work must not resolve it again.
 *
 * A VALUE OBJECT, not a mutable bag. Python carried this inside `tool_state`, a
 * dict-typed session field whose smell is on record, and the cure is that every
 * transition here answers a new envelope: the state of a turn at any moment is
 * one value, which is exactly what makes "write it back once, with the run"
 * expressible at all.
 *
 * Refs are deliberately NOT here. A minted ref belongs to the RUN that minted it
 * and is rehydrated from `run_steps` (#1279); this is per SESSION. Keeping the
 * two lifetimes apart is the difference between an envelope and the bag.
 */
import type { CurrentAnime, OrderedCandidate } from "../tools/catalog-tool-session.ts";

/** A question a turn asked and no tool could answer. */
export interface PendingClarification {
  readonly reason: string;
  readonly candidates: readonly OrderedCandidate[];
}

export class SessionEnvelope {
  /** A session no turn has left anything on yet. */
  static readonly empty = new SessionEnvelope(null, null);

  readonly pendingClarification: PendingClarification | null;
  readonly currentAnime: CurrentAnime | null;

  constructor(pending: PendingClarification | null, anime: CurrentAnime | null) {
    this.pendingClarification = pending;
    this.currentAnime = anime;
  }

  /** The turn asked something only the user can settle. */
  withClarification(reason: string, candidates: readonly OrderedCandidate[]): SessionEnvelope {
    return new SessionEnvelope({ reason, candidates }, this.currentAnime);
  }

  /** A tool answered instead, so nothing is open any more. */
  cleared(): SessionEnvelope {
    return new SessionEnvelope(null, this.currentAnime);
  }

  /** The session resolved the work it is about. */
  withAnime(anime: CurrentAnime): SessionEnvelope {
    return new SessionEnvelope(this.pendingClarification, anime);
  }
}

/**
 * Where one session's envelope lives between its turns.
 *
 * A port: the turn machinery only ever loads one and saves one, so a card that
 * moves the storage (see the adapter's decision note) changes one class.
 */
export interface SessionEnvelopeStore {
  load(): Promise<SessionEnvelope>;
  save(envelope: SessionEnvelope): Promise<void>;
}
