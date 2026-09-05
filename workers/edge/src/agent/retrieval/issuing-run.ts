/**
 * The run that issued the tool calls one transcript row carries (E-2 #1381).
 *
 * Since #1377 every turn's calls are replayed as structured assistant
 * messages, and each such row names the run that made them in its
 * `response_data` — `ToolCallEnvelope`, written by
 * `session/turn-store.ts::toolCallEnvelopeOf`'s own writer. This is the read
 * side of that marker, on the retrieval's row type.
 *
 * It exists so the settled-step read can be scoped to the PAGE: the transcript
 * is paginated and a session's steps are not, so without the runs a page
 * actually shows, every page of a long session would ship every step the
 * session ever settled.
 *
 * Only the object form is read. The legacy string-encoded envelopes
 * `transcript-message.ts` decodes predate the TS tier entirely, and no such row
 * can name a run.
 */
import { isJsonRecord } from "../json-record.ts";
import type { TranscriptRow } from "./transcript-message.ts";

/** The run named on the row, or none — the row carries no tool call. */
export function issuingRunOf(row: TranscriptRow): string | null {
  const held = row.responseData;
  if (!isJsonRecord(held) || typeof held.run_id !== "string") return null;
  return held.run_id;
}
