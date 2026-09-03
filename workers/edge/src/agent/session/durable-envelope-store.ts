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
 * Reading is guarded because `get` answers `unknown` and an older deployment
 * could have written a shape this one no longer reads. Every field of a stored
 * candidate is checked — required ones for presence, optional ones for type
 * when they are there — so the one assertion below is earned rather than
 * assumed, and a clarification that is only half readable reads as ABSENT
 * rather than as itself: a question the next turn cannot state in full is
 * worse than no question at all.
 */
import { isJsonRecord } from "../json-record.ts";
import type { CurrentAnime, OrderedCandidate } from "../tools/catalog-tool-session.ts";
import {
  SessionEnvelope,
  type PendingClarification,
  type SessionEnvelopeStore,
} from "./session-envelope.ts";

/** The one key a session's envelope is written under. */
export const SESSION_ENVELOPE_KEY = "envelope";

/**
 * The slice of `DurableObjectStorage` this store uses. Narrow on purpose, the
 * way `SessionRunQueue`'s is: `DurableObjectState.storage` satisfies it
 * structurally, so a test hands in a real Map-backed storage rather than a
 * stand-in that only pretends to be one.
 */
export interface EnvelopeStorage {
  put(key: string, value: unknown): Promise<void>;
  get(key: string): Promise<unknown>;
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

/** The open question, or nothing — a partly readable one is not a question. */
function storedClarification(value: unknown): PendingClarification | null {
  if (!isJsonRecord(value)) return null;
  const { reason, candidates } = value;
  if (typeof reason !== "string" || !Array.isArray(candidates)) return null;
  const read = candidates.flatMap((one) => storedCandidate(one) ?? []);
  return read.length === candidates.length ? { reason, candidates: read } : null;
}

export class DurableEnvelopeStore implements SessionEnvelopeStore {
  readonly #storage: EnvelopeStorage;

  constructor(storage: EnvelopeStorage) {
    this.#storage = storage;
  }

  async load(): Promise<SessionEnvelope> {
    const held = await this.#storage.get(SESSION_ENVELOPE_KEY);
    if (!isJsonRecord(held)) return SessionEnvelope.empty;
    return new SessionEnvelope(storedClarification(held.pendingClarification), storedAnime(held.currentAnime));
  }

  /**
   * One awaited `put` of the WHOLE envelope. Cloudflare only coalesces writes
   * with no `await` between them ("Rules of Durable Objects", Write coalescing),
   * so this one commits on its own; and because the value is whole rather than a
   * delta, a write that happens twice cannot apply anything twice.
   */
  async save(envelope: SessionEnvelope): Promise<void> {
    await this.#storage.put(SESSION_ENVELOPE_KEY, {
      pendingClarification: envelope.pendingClarification,
      currentAnime: envelope.currentAnime,
    });
  }
}
