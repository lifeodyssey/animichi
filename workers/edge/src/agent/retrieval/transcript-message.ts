/**
 * One stored transcript row as the published message it becomes (W1-5 #1254).
 *
 * The narrowing here is a port of the Python `_response_data`
 * (`apps/agent/src/animichi/application/get_session_history.py`): the envelope
 * column is `jsonb` and the rows in it were written by three different eras of
 * this service, so it may be an object, a JSON string holding one, or
 * something else entirely. Only two members of it are published — `intent` and
 * `success` — and each is published only when it has the type the contract
 * says it has. Everything else reads as absent rather than as itself, because
 * this surface is parsed by the browser (`GetSessionHistoryResponse`) and a
 * stray member would fail the parse for the whole page.
 *
 * An envelope with NEITHER member publishes nothing at all, which the same rule
 * carried to its end: a row whose column says nothing this surface understands
 * is a row with no envelope, not a row with two nulls. It became observable
 * with #1288 — a selection turn's USER row carries its selection in that column
 * — and the container writes no user envelope, so answering `null` is what
 * keeps the two tiers' history identical.
 */
import type { SessionHistoryMessage } from "@animichi/contract/agent-contract";
import { isJsonRecord } from "../json-record.ts";

/** One transcript row as the store holds it. */
export interface TranscriptRow {
  readonly role: string;
  readonly content: string;
  /** The `messages.response_data` jsonb, untrusted and any shape at all. */
  readonly responseData: unknown;
  /** The row's `created_at` as ISO-8601 text, normalised by the adapter. */
  readonly createdAt: string;
}

type ResponseEnvelope = NonNullable<SessionHistoryMessage["response_data"]>;

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** A JSON string holding the envelope, as the older rows stored it. */
function decoded(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function envelopeOf(value: unknown): ResponseEnvelope | null {
  const decodedValue = typeof value === "string" ? decoded(value) : value;
  if (!isJsonRecord(decodedValue)) return null;
  const envelope = { intent: stringOrNull(decodedValue.intent), success: booleanOrNull(decodedValue.success) };
  return envelope.intent === null && envelope.success === null ? null : envelope;
}

/** The published message one stored row is. */
export function transcriptMessage(row: TranscriptRow): SessionHistoryMessage {
  return {
    role: row.role,
    content: row.content,
    response_data: envelopeOf(row.responseData),
    created_at: row.createdAt,
  };
}
