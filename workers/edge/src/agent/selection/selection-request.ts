/**
 * The selection half of one `POST /v1/chat` body (card #1288).
 *
 * A PORT of `apps/agent`'s `chat_body.ChatBody` × `schemas.PublicAPIRequest`
 * `validate_request`, reduced to what actually reaches a selection: the two
 * exclusive id lists, the clarification the candidate list answers, and the
 * departure point a point list may be routed from. Python's normalization is
 * kept exactly — trim, drop empties, first-occurrence dedupe (`_normalize_ids`)
 * — because the ids are compared against a pending clarification's membership
 * and a differently normalized list is a different selection.
 *
 * IT IS ALSO THE DURABLE FORM. A selection turn is admitted by the intake and
 * answered later, inside the session's alarm, so the request has to survive the
 * gap: `selectionEnvelope` is what the intake writes into the user message's
 * `response_data` and `selectionIn` is what the alarm reads back out of it
 * (`turn-store.ts`). That column is the only carrier available without DDL, and
 * it is the RIGHT one for a different reason: it is written in the SAME
 * transaction as the `runs` row, so a turn can never exist without the selection
 * that defines it — which a Durable Object write after the commit could not
 * promise, and the sweeper's at-least-once retry would then drive as a plain
 * model turn.
 *
 * Pure: no bindings, no clock, no database.
 */
import { isJsonRecord } from "../json-record.ts";

/** The marker that tells a stored `response_data` apart from an assistant
 * answer envelope, which is the only other thing that column ever holds. */
const SELECTION_MARKER = "selection";

/**
 * One selection, discriminated on WHICH deterministic path it takes.
 *
 * Python kept the two apart with a validator (`selected_point_ids and
 * selected_candidate_ids are exclusive`); a union makes the same rule a shape
 * rather than a check, so no downstream branch has to ask what happens when
 * both arrive.
 */
export type SelectionRequest =
  | {
      readonly of: "points";
      readonly pointIds: readonly string[];
      /** The user's departure point, as the body spelled it (`"lat,lng"` or a
       * place name) — Python's `PublicAPIRequest.origin`. */
      readonly origin: string | null;
      readonly locale: string;
    }
  | {
      readonly of: "candidates";
      readonly candidateIds: readonly string[];
      /** The `PendingClarification.id` this pick claims to answer. */
      readonly clarificationId: number;
      readonly locale: string;
    };

/** Python's `_normalize_ids`: trim, drop empties, keep first occurrences. */
export function normalizedIds(values: readonly unknown[]): string[] {
  const trimmed = values.flatMap((raw) => (typeof raw === "string" ? [raw.trim()] : []));
  return [...new Set(trimmed.filter((value) => value !== ""))];
}

/** A body member that is a list, or nothing — a non-list reads as absent, the
 * way `ChatBody`'s `list[StrictStr] | None` refuses to coerce one. */
function idList(payload: Record<string, unknown>, field: string): string[] | null {
  const raw = payload[field];
  return Array.isArray(raw) ? normalizedIds(raw as readonly unknown[]) : null;
}

/** The departure point, trimmed to nothing the way `validate_request` does. */
function originIn(payload: Record<string, unknown>): string | null {
  const { origin, origin_lat: lat, origin_lng: lng } = payload;
  if (typeof lat === "number" && typeof lng === "number") return `${String(lat)},${String(lng)}`;
  if (typeof origin !== "string") return null;
  return origin.trim() === "" ? null : origin.trim();
}

/** The clarification id a candidate pick names, or null when it named none.
 * Python required one (`clarification_id is required iff …`); the web sends
 * `null` when the card it read carried none, which is the same absence. */
function clarificationIdIn(payload: Record<string, unknown>): number | null {
  const raw = payload.clarification_id;
  return typeof raw === "number" && Number.isSafeInteger(raw) ? raw : null;
}

/** The point selection this body carries, or null when it carries none. */
function pointSelection(payload: Record<string, unknown>, locale: string): SelectionRequest | null {
  const pointIds = idList(payload, "selected_point_ids");
  if (pointIds === null || pointIds.length === 0) return null;
  return { of: "points", pointIds, origin: originIn(payload), locale };
}

/** The candidate pick this body carries, or null when it carries none. A pick
 * with no clarification id is not a pick: it can name no question, so it can
 * only be judged stale, and the refusal is the same one either way. */
function candidateSelection(payload: Record<string, unknown>, locale: string): SelectionRequest | null {
  const candidateIds = idList(payload, "selected_candidate_ids");
  if (candidateIds === null || candidateIds.length === 0) return null;
  return { of: "candidates", candidateIds, clarificationId: clarificationIdIn(payload) ?? 0, locale };
}

/**
 * The selection one chat body submits, or null for an ordinary text turn.
 *
 * Points win when a body carries both, which cannot happen from `apps/web`
 * (each transport sends one) and which Python refused outright. Refusing is not
 * available here — a 422 on a body the browser never sends would be a new
 * refusal on a FALLBACK wire — so the exclusivity is resolved in the order
 * `_kind_from_request` itself tests them.
 */
export function selectionIn(payload: unknown, locale: string): SelectionRequest | null {
  if (!isJsonRecord(payload)) return null;
  return pointSelection(payload, locale) ?? candidateSelection(payload, locale);
}

/** One selection as the user message's `response_data` stores it. */
export function selectionEnvelope(selection: SelectionRequest): Record<string, unknown> {
  return { [SELECTION_MARKER]: selection };
}

/** The selection a stored envelope holds, re-read with every field checked —
 * the column is untrusted on the way back in, and a half-readable selection is
 * no selection: answering the wrong points is worse than answering none. */
export function storedSelection(held: unknown): SelectionRequest | null {
  if (!isJsonRecord(held)) return null;
  const stored: unknown = held[SELECTION_MARKER];
  if (!isJsonRecord(stored) || typeof stored.locale !== "string") return null;
  if (stored.of === "points") return storedPoints(stored, stored.locale);
  return stored.of === "candidates" ? storedCandidates(stored, stored.locale) : null;
}

function storedPoints(stored: Record<string, unknown>, locale: string): SelectionRequest | null {
  const pointIds = Array.isArray(stored.pointIds) ? normalizedIds(stored.pointIds as unknown[]) : [];
  if (pointIds.length === 0) return null;
  const origin = typeof stored.origin === "string" ? stored.origin : null;
  return { of: "points", pointIds, origin, locale };
}

function storedCandidates(stored: Record<string, unknown>, locale: string): SelectionRequest | null {
  const ids = Array.isArray(stored.candidateIds) ? normalizedIds(stored.candidateIds as unknown[]) : [];
  const clarificationId = stored.clarificationId;
  if (ids.length === 0 || typeof clarificationId !== "number") return null;
  return { of: "candidates", candidateIds: ids, clarificationId, locale };
}
