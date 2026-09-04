/**
 * The session envelope, kept in the Durable Object's own storage (card #1280).
 *
 * STORAGE DECISION — DO storage, not a Neon column on `sessions`:
 * 1. Spec §三 makes the session's DO the single writer of session state, and
 *    `idFromName(sessionId)` (`session-wakeup.ts`) makes this storage
 *    session-scoped by construction; a column invites a second writer to exist.
 * 2. Nothing outside the DO reads it: the only agent-tier read that runs in the
 *    Worker is `retrieval/`, and it publishes `intent`/`success` off
 *    `messages.response_data` plus the latest run's status — never this.
 * 3. It is written on the alarm that just settled the turn, so a column would
 *    add a Neon round trip to a path that has nothing else to say to Neon.
 * 4. No migration, and therefore none of the `must-be-owner` staging risk that
 *    an ALTER on the shared `sessions` table carries today.
 * 5. The price is that it cannot be joined or inspected in SQL. The card that
 *    needs that (a session-state read outside the DO) moves it to a column and
 *    pays the migration then; `SessionEnvelopeStore` is where it swaps.
 *
 * The two ledgers (#1290) are written through `encodedMemory` rather than
 * straight from the envelope on purpose: `put` structured-clones its value and
 * a clone restores no class prototype, so a `FactLedger` written as itself
 * would come back a plain object that cannot answer any of its own questions.
 * `storedMemory` is the guarded read that turns it back into the ledgers, with
 * both caps re-applied.
 *
 * Reading is guarded because `get` answers `unknown` and an older deployment
 * could have written a shape this one no longer reads. Every field of a stored
 * candidate is checked — required ones for presence, optional ones for type
 * when they are there — so the one assertion below is earned rather than
 * assumed, and a clarification that is only half readable reads as ABSENT
 * rather than as itself: a question the next turn cannot state in full is
 * worse than no question at all.
 */
import { isJsonRecord } from "../json-record.ts";
import { encodedMemory, storedMemory } from "../memory/stored-memory.ts";
import type { CurrentAnime, OrderedCandidate } from "../tools/catalog-tool-session.ts";
import {
  SessionEnvelope,
  type PendingClarification,
  type SessionEnvelopeStore,
} from "./session-envelope.ts";

/** The one key a session's envelope is written under. */
export const SESSION_ENVELOPE_KEY = "envelope";

/** Where one run's envelope waits between its staging and its promotion. Keyed
 * by run so two runs of one session can never promote each other's answer. */
export function stagedEnvelopeKey(runId: string): string {
  return `envelope:pending:${runId}`;
}

/**
 * The slice of `DurableObjectStorage` this store uses. Narrow on purpose, the
 * way `SessionRunQueue`'s is: `DurableObjectState.storage` satisfies it
 * structurally, so a test hands in a real Map-backed storage rather than a
 * stand-in that only pretends to be one.
 */
export interface EnvelopeStorage {
  put(key: string, value: unknown): Promise<void>;
  get(key: string): Promise<unknown>;
  delete(key: string): Promise<boolean>;
}

/** The resolved work, whose two fields are both required and both read. */
function storedAnime(value: unknown): CurrentAnime | null {
  if (!isJsonRecord(value)) return null;
  const { bangumiId, title } = value;
  if (typeof bangumiId !== "string" || typeof title !== "string") return null;
  return { bangumiId, title };
}

/** Every optional field `OrderedCandidate` declares, and the type it declares it
 * as. Listing them is what lets the assertion below be earned rather than
 * assumed: a stored `points_count` that came back a string is caught here. */
const OPTIONAL_CANDIDATE_FIELDS = {
  cover_url: "string",
  points_count: "number",
  lat: "number",
  lng: "number",
  effective_radius_m: "number",
} as const;

/** Every optional field this candidate DOES carry has the type it claims to. */
function optionalFieldsHold(value: Record<string, unknown>): boolean {
  return Object.entries(OPTIONAL_CANDIDATE_FIELDS).every(
    ([field, type]) => value[field] === undefined || typeof value[field] === type,
  );
}

/** One offered choice. `id`/`title` are required and the rest are checked when
 * present, so nothing reaches the next turn with a field it cannot read. */
function storedCandidate(value: unknown): OrderedCandidate | null {
  if (!isJsonRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.title !== "string") return null;
  return optionalFieldsHold(value) ? (value as unknown as OrderedCandidate) : null;
}

/** The open question, or nothing — a partly readable one is not a question.
 * A stored question with no readable `id` is not readable either: without it a
 * pick could not be told from a stale one, which is the guard's whole job. */
function storedClarification(value: unknown): PendingClarification | null {
  if (!isJsonRecord(value)) return null;
  const { id, reason, candidates } = value;
  if (typeof id !== "number" || typeof reason !== "string" || !Array.isArray(candidates)) return null;
  const read = candidates.flatMap((one) => storedCandidate(one) ?? []);
  return read.length === candidates.length ? { id, reason, candidates: read } : null;
}

/** The counter, defaulted to zero for an envelope written before #1288. */
function storedRevision(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export class DurableEnvelopeStore implements SessionEnvelopeStore {
  readonly #storage: EnvelopeStorage;

  constructor(storage: EnvelopeStorage) {
    this.#storage = storage;
  }

  async load(): Promise<SessionEnvelope> {
    const held = await this.#storage.get(SESSION_ENVELOPE_KEY);
    if (!isJsonRecord(held)) return SessionEnvelope.empty;
    return new SessionEnvelope(
      storedClarification(held.pendingClarification),
      storedAnime(held.currentAnime),
      {
        clarificationRevision: storedRevision(held.clarificationRevision),
        memory: storedMemory(held.memory),
      },
    );
  }

  /**
   * One awaited `put` of the WHOLE envelope, under the run's own key.
   * Cloudflare only coalesces writes with no `await` between them ("Rules of
   * Durable Objects", Write coalescing), so this one commits on its own — which
   * is the entire point: it has to be on disk before the terminal row is.
   */
  async stage(runId: string, envelope: SessionEnvelope): Promise<void> {
    await this.#storage.put(stagedEnvelopeKey(runId), {
      pendingClarification: envelope.pendingClarification,
      currentAnime: envelope.currentAnime,
      clarificationRevision: envelope.clarificationRevision,
      memory: encodedMemory(envelope.memory),
    });
  }

  /**
   * Copy the staged value over, then drop the staging — in that order, so a
   * failure between them leaves the staging for the next promotion to redo.
   * Both halves are idempotent: the value is whole rather than a delta, and a
   * run whose staging is already gone promotes nothing at all, which is what
   * makes a retry of an already-promoted run a no-op.
   */
  async promote(runId: string): Promise<void> {
    const key = stagedEnvelopeKey(runId);
    const staged = await this.#storage.get(key);
    if (staged === undefined) return;
    await this.#storage.put(SESSION_ENVELOPE_KEY, staged);
    await this.#storage.delete(key);
  }
}
