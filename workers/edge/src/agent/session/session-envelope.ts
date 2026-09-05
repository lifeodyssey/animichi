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
 * the entities rescued from frozen returns, as one `SessionMemory` value. They belong here
 * for the same reason the two facts above do: the NEXT turn is what needs them,
 * they are written on the alarm that settles a run, and this envelope is
 * already what that alarm stages and promotes in one write. Adding them as one
 * field rather than two keeps every transition below a single carry-forward.
 */
import type { CurrentAnime, OrderedCandidate } from "../tools/catalog-tool-session.ts";
import { EMPTY_SESSION_MEMORY, type SessionMemory } from "../memory/session-memory.ts";

/**
 * A question a turn asked and no tool could answer.
 *
 * `id` is the STALE GUARD, and #1288 is the card that earned it back. #1280
 * dropped Python's `PendingClarification.revision` because nothing on this tier
 * could yet answer a clarification, so a counter guarding a selection guarded
 * nothing. Now a selection turn exists (`src/agent/selection/`), and a pick
 * arrives from a card the browser may still be showing after the session has
 * moved on — so the pick has to name WHICH question it answers, exactly as
 * Python's `validate_candidate_selection` compared `clarification_id` against
 * `pending.revision`.
 *
 * It is minted from `SessionEnvelope.clarificationRevision`, which only ever
 * increases, so an id is never reused inside a session and a pick for an
 * evicted question can never validate against the one that replaced it. The
 * projection publishes it as the contract's `clarification_id`
 * (`turn-answer-part.ts`), which is how the browser gets one to send back.
 */
export interface PendingClarification {
  readonly id: number;
  readonly reason: string;
  readonly candidates: readonly OrderedCandidate[];
}

/**
 * Everything an envelope carries BEYOND the two facts a turn names directly:
 * the counter that keeps clarification ids unique for the life of a session
 * (#1288) and what the session remembers (#1290).
 *
 * One value rather than two more positional parameters. Every transition below
 * passes both through untouched and changes at most one of them, so a
 * four-argument constructor would be four chances to swap two of the same type
 * — and this way a card that carries a THIRD fact adds a member here instead of
 * re-ordering every call site.
 */
export interface CarriedFacts {
  readonly clarificationRevision: number;
  readonly memory: SessionMemory;
}

const NOTHING_CARRIED: CarriedFacts = { clarificationRevision: 0, memory: EMPTY_SESSION_MEMORY };

export class SessionEnvelope {
  /** A session no turn has left anything on yet. */
  static readonly empty = new SessionEnvelope(null, null);

  readonly pendingClarification: PendingClarification | null;
  readonly currentAnime: CurrentAnime | null;
  /** The highest clarification id this session has ever minted. Kept after the
   * question is answered, because it is what makes the NEXT one strictly
   * greater — Python held the same counter as `clarification_revision`. */
  readonly clarificationRevision: number;
  /** What the session remembers: its fact ledger and its retained entities. */
  readonly memory: SessionMemory;

  constructor(
    pending: PendingClarification | null,
    anime: CurrentAnime | null,
    carried: CarriedFacts = NOTHING_CARRIED,
  ) {
    this.pendingClarification = pending;
    this.currentAnime = anime;
    this.clarificationRevision = Math.max(carried.clarificationRevision, pending?.id ?? 0);
    this.memory = carried.memory;
  }

  /** What this envelope hands to its own next form, unchanged. */
  get #carried(): CarriedFacts {
    return { clarificationRevision: this.clarificationRevision, memory: this.memory };
  }

  /** The turn asked something only the user can settle, under a fresh id. */
  withClarification(reason: string, candidates: readonly OrderedCandidate[]): SessionEnvelope {
    const clarificationRevision = this.clarificationRevision + 1;
    const asked = { id: clarificationRevision, reason, candidates };
    return new SessionEnvelope(asked, this.currentAnime, { ...this.#carried, clarificationRevision });
  }

  /** A tool answered instead, so nothing is open any more. The revision stays:
   * dropping it would let the next question reuse an id a stale pick names. */
  cleared(): SessionEnvelope {
    return new SessionEnvelope(null, this.currentAnime, this.#carried);
  }

  /** The session resolved the work it is about — or, with `null`, learned that
   * it is about several works at once and therefore about no single one
   * (Python's `_set_current_anime` on a multi-work pick). */
  withAnime(anime: CurrentAnime | null): SessionEnvelope {
    return new SessionEnvelope(this.pendingClarification, anime, this.#carried);
  }

  /** The turn recorded a fact, or a frozen return rescued an entity (#1290). */
  remembering(memory: SessionMemory): SessionEnvelope {
    return new SessionEnvelope(this.pendingClarification, this.currentAnime, { ...this.#carried, memory });
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
