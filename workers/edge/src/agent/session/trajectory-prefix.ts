/**
 * The frozen prefix one eval case starts from (E-1 #1380, spec §十 10.1;
 * 李博杰《深入理解 AI Agent》ch.7「轨迹前缀回归任务」).
 *
 * A VALUE, read once off an untrusted body and never touched again. Everything
 * downstream — the intake submission, the settled step, the session envelope —
 * is derived from this one object, so a member that cannot be read is a prefix
 * that does not exist rather than a prefix with a hole in it: the same rule
 * `durable-envelope-store.ts` reads a stored clarification by, and for the same
 * reason. A half-seeded starting point would be measured as if it were whole.
 *
 * NO ZOD HERE. `packages/contract/src/staging-prefix-contract.ts` declares the
 * shape for the Node-side harness that SENDS it; the Worker may not load zod at
 * all (#1285), so the read below is the edge's own guarded parse. The two are
 * held together by `test/trajectory-prefix-body.test.ts`, which parses a
 * contract-valid body with this module.
 */
import { isJsonRecord } from "../json-record.ts";
import type { JsonValue } from "@earendil-works/pi-ai";
import type { CurrentAnime, OrderedCandidate } from "../tools/catalog-tool-session.ts";
import type { PendingClarification } from "./session-envelope.ts";

/** The one tool call the seeded turn made, and the result it settled. */
export interface PrefixToolCall {
  readonly toolName: string;
  /** `run_steps.input`: what the tool executed with. An OBJECT, because it is
   * also the `arguments` of the assistant tool-call message the transcript
   * replays, and pi types those as a record — a bare scalar could be stored
   * but could never be replayed as the call it came from. */
  readonly params: Record<string, JsonValue>;
  /** The text the model read back — the step's `content`. */
  readonly resultText: string;
  /** `run_steps.result.details`, or `null` when the call recorded none. */
  readonly resultDetails: JsonValue;
}

/** One frozen prefix: the turn to write, and the state it leaves behind. */
export interface TrajectoryPrefix {
  /** The idempotency key: this becomes the seeded message's `client_message_id`. */
  readonly caseId: string;
  readonly userText: string;
  readonly toolCall: PrefixToolCall;
  readonly assistantText: string;
  readonly pendingClarification: PendingClarification | null;
  readonly currentAnime: CurrentAnime | null;
}

/** A non-empty string member, or nothing. */
function textIn(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** A JSON member the body carries as TEXT, parsed once here — the wire shape
 * `SessionHistoryStep.params` already uses, kept for the reason it was chosen
 * there: arbitrary JSON on a boundary must not become an untyped object map. */
function jsonTextIn(payload: Record<string, unknown>, key: string): JsonValue | undefined {
  const raw = payload[key];
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return undefined;
  }
}

/** The same read, refused unless the text spells an OBJECT. */
function jsonObjectTextIn(
  payload: Record<string, unknown>, key: string,
): Record<string, JsonValue> | undefined {
  const parsed = jsonTextIn(payload, key);
  return isJsonRecord(parsed) ? parsed : undefined;
}

/** Every optional member `OrderedCandidate` declares, with the type it declares
 * it as — the same table `durable-envelope-store.ts` checks a STORED candidate
 * against, applied one step earlier, on the way in. */
const OPTIONAL_CANDIDATE_FIELDS = {
  cover_url: "string",
  points_count: "number",
  lat: "number",
  lng: "number",
  effective_radius_m: "number",
} as const;

function optionalFieldsHold(value: Record<string, unknown>): boolean {
  return Object.entries(OPTIONAL_CANDIDATE_FIELDS).every(
    ([field, type]) => value[field] === undefined || typeof value[field] === type,
  );
}

/** One offered choice, or nothing when any member it carries is unreadable. */
function candidateIn(value: unknown): OrderedCandidate | null {
  if (!isJsonRecord(value)) return null;
  if (typeof value.id !== "string" || value.id === "" || typeof value.title !== "string") return null;
  return optionalFieldsHold(value) ? (value as unknown as OrderedCandidate) : null;
}

/** The clarification's own id: a positive integer, because it is also the
 * session's clarification revision and revisions only ever increase. */
function clarificationId(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

/** Every offered choice, or nothing when one of them is unreadable — a PARTLY
 * readable question is refused rather than trimmed: the ids a reply names are
 * compared against this list, so a dropped candidate is a refused reply. */
function candidatesIn(value: unknown): OrderedCandidate[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const read = value.map(candidateIn);
  return read.every((one) => one !== null) ? read : null;
}

/** The open question, or nothing — a prefix may legitimately leave none. */
function clarificationIn(value: unknown): PendingClarification | null | undefined {
  if (value === null) return null;
  if (!isJsonRecord(value)) return undefined;
  const id = clarificationId(value.id);
  const reason = textIn(value, "reason");
  const candidates = candidatesIn(value.candidates);
  if (id === null || reason === null || candidates === null) return undefined;
  return { id, reason, candidates };
}

/** The resolved work, or nothing — both members required, both read. */
function animeIn(value: unknown): CurrentAnime | null | undefined {
  if (value === null) return null;
  if (!isJsonRecord(value)) return undefined;
  const { bangumi_id: bangumiId, title } = value;
  if (typeof bangumiId !== "string" || bangumiId === "" || typeof title !== "string") return undefined;
  return { bangumiId, title };
}

function toolCallIn(value: unknown): PrefixToolCall | undefined {
  if (!isJsonRecord(value)) return undefined;
  const toolName = textIn(value, "tool_name");
  const params = jsonObjectTextIn(value, "params");
  const resultText = value.result_text;
  if (toolName === null || params === undefined || typeof resultText !== "string") return undefined;
  const details = value.result_details === undefined ? null : jsonTextIn(value, "result_details");
  return details === undefined ? undefined : { toolName, params, resultText, resultDetails: details };
}

/** The prefix a request body carries, or `null` when it carries none this
 * module can read whole. */
export function trajectoryPrefixIn(payload: unknown): TrajectoryPrefix | null {
  if (!isJsonRecord(payload)) return null;
  const caseId = textIn(payload, "case_id");
  const userText = textIn(payload, "user_text");
  const assistantText = textIn(payload, "assistant_text");
  const toolCall = toolCallIn(payload.tool_call);
  const pendingClarification = clarificationIn(payload.pending_clarification);
  const currentAnime = animeIn(payload.current_anime);
  if (caseId === null || userText === null || assistantText === null) return null;
  if (toolCall === undefined || pendingClarification === undefined || currentAnime === undefined) return null;
  return { caseId, userText, toolCall, assistantText, pendingClarification, currentAnime };
}
