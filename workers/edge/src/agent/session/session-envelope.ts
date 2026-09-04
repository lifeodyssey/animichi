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
 *
 * SINCE #1290 IT CARRIES THE SESSION'S MEMORY TOO — the fact ledger and the
 * compaction-retained entities, as one `SessionMemory` value. They belong here
 * for the same reason the two facts above do: the NEXT turn is what needs them,
 * they are written on the alarm that settles a run, and this envelope is
 * already what that alarm stages and promotes in one write. Adding them as one
 * field rather than two keeps every transition below a single carry-forward.
 */
import type { CurrentAnime, OrderedCandidate } from "../tools/catalog-tool-session.ts";
import { EMPTY_SESSION_MEMORY, type SessionMemory } from "../memory/session-memory.ts";

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
  /** What the session remembers: its fact ledger and its retained entities. */
  readonly memory: SessionMemory;

  constructor(
    pending: PendingClarification | null,
    anime: CurrentAnime | null,
    memory: SessionMemory = EMPTY_SESSION_MEMORY,
  ) {
    this.pendingClarification = pending;
    this.currentAnime = anime;
    this.memory = memory;
  }

  /** The turn asked something only the user can settle. */
  withClarification(reason: string, candidates: readonly OrderedCandidate[]): SessionEnvelope {
    return new SessionEnvelope({ reason, candidates }, this.currentAnime, this.memory);
  }

  /** A tool answered instead, so nothing is open any more. */
  cleared(): SessionEnvelope {
    return new SessionEnvelope(null, this.currentAnime, this.memory);
  }

  /** The session resolved the work it is about. */
  withAnime(anime: CurrentAnime): SessionEnvelope {
    return new SessionEnvelope(this.pendingClarification, anime, this.memory);
  }

  /** The turn recorded a fact, or compaction rescued an entity (#1290). */
  remembering(memory: SessionMemory): SessionEnvelope {
    return new SessionEnvelope(this.pendingClarification, this.currentAnime, memory);
  }
}

/**
 * Where one session's envelope lives between its turns.
 *
 * Saving is TWO steps, not one, and the split is the only defence a pair of
 * writes in two different stores can have. The run's terminal row lands in Neon
 * and the envelope lands in Durable Object storage, so they cannot share a
 * transaction; what they can share is an order. `stage` writes the envelope
 * under the run's own key BEFORE the terminal row, and `promote` makes it the
 * session's afterwards — so a crash between the two leaves the answer on disk
 * for the retry rather than losing it (PR #1282).
 *
 * A port: a card that moves the storage (see the adapter's decision note)
 * changes one class.
 */
export interface SessionEnvelopeStore {
  load(): Promise<SessionEnvelope>;
  /** Bank one run's envelope before that run's terminal row is written. */
  stage(runId: string, envelope: SessionEnvelope): Promise<void>;
  /**
   * Make one run's staged envelope the session's, and drop the staging.
   * Idempotent in both directions: a run with nothing staged promotes nothing,
   * and a promotion that runs twice writes the same whole value once.
   */
  promote(runId: string): Promise<void>;
}
