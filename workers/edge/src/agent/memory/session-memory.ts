/**
 * What a session remembers, and how one turn reads and replaces it (card
 * #1290).
 *
 * The two ledgers travel as ONE value because they are written at the same
 * moment and read at the same moment: `SessionEnvelope` carries them across
 * turns, `agent-status.ts` renders both into the `<agent_status>` bar,
 * and the Durable Object stages and promotes the whole envelope in one write.
 * Two separate fields on the envelope would be two things to keep in step for
 * no gain.
 *
 * They stay two SEPARATE ledgers inside it, and that was Python's OQ-8 ruling
 * rather than an accident: a retained entity is rescued by compaction and dies
 * with the raw history it was rescued from, while a fact is derived from a
 * settled tool step and outlives every compaction. Different lifecycles,
 * different write paths, no shared record model.
 *
 * `TurnMemory` is the port the two writers hold — `context-compaction.ts` and
 * `turn-fact-recorder.ts` — and `TurnCatalogSession` is what fulfils it, since
 * the envelope a turn mutates is already its state. Keeping it a port rather
 * than the class itself is what lets both writers be driven in a unit test with
 * no catalog, no store and no Durable Object.
 */
import { FactLedger } from "./fact-ledger.ts";
import { RetainedEntityLedger } from "./retained-entity-ledger.ts";

/** The two ledgers one session carries between its turns. */
export interface SessionMemory {
  readonly facts: FactLedger;
  readonly retainedEntities: RetainedEntityLedger;
}

/** A session that has neither recorded a fact nor rescued an entity. */
export const EMPTY_SESSION_MEMORY: SessionMemory = {
  facts: FactLedger.empty,
  retainedEntities: RetainedEntityLedger.empty,
};

/** The seam both memory writers of one turn hold. */
export interface TurnMemory {
  /** The two ledgers as this turn has them right now. */
  readonly memory: SessionMemory;
  /**
   * The title the session's `currentAnime` already carries in full, or null.
   *
   * Compaction reads it to skip re-retaining a title that is already carried
   * unabridged elsewhere in the prompt — retaining it a second time would just
   * spend the same budget twice (Python's `_retain_entity`).
   */
  readonly resolvedTitle: string | null;
  /** Publish what this turn learned. The whole value, never a delta, so
   * applying it twice cannot count twice. */
  remember(memory: SessionMemory): void;
}
