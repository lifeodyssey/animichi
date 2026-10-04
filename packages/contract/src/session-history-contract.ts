/**
 * The conversation-read boundaries of the Agent HTTP surface.
 *
 * `GET /v1/conversations/{id}/messages` (SESSION-1 #959) is one page of a
 * session read back: its transcript, its revision, the state of its latest run
 * (W1-5 #1254) and the params its runs' tools executed with (E-2 #1381).
 * `GET /v1/conversations` (Card E of the #1317 decomposition) is the index
 * that page belongs to.
 *
 * It is its own module rather than a section of `agent-contract.ts` because it
 * is its own surface: the reads the browser makes of conversations it already
 * owns, each with one use case on each tier
 * (`workers/edge/src/agent/views/`). `agent-contract.ts` keeps the shapes that
 * have no such home — health, the BYOK probe, the turn request.
 *
 * `packages/contract/src/index.ts` re-exports these shapes so the root import
 * path is unchanged.
 */

import { z } from "zod";

/** One persisted transcript row (role, content, envelope, timestamp). */
export const SessionHistoryMessage = z.object({
  role: z.string(),
  operation_id: z.string().optional(),
  content: z.string(),
  response_data: z.object({
    intent: z.string().nullish(),
    success: z.boolean().nullish(),
  }).nullable().optional(),
  created_at: z.string(),
});
export type SessionHistoryMessage = z.infer<typeof SessionHistoryMessage>;

/**
 * Why a turn ended `failed` — the `runs_failure_reason_check` vocabulary
 * verbatim (the retired `runs` table's status vocabulary). Bounded on
 * purpose: the reason reaches the browser, so it may name a lifecycle outcome
 * and never an internal detail. `workers/edge/test/agent-runs-schema.test.ts`
 * holds this list and the database's CHECK to each other.
 */
export const RunFailureReason = z.enum([
  "lease_expired",
  "deadline_exceeded",
  "provider_failed",
  "tool_failed",
  "cancelled",
  "internal_error",
]);
export type RunFailureReason = z.infer<typeof RunFailureReason>;

/**
 * The state of the session's latest run (W1-5 #1254, spec §二 "断线语义").
 *
 * History reports the native lane's current or latest immutable result. The
 * browser reconnects through the dedicated stream GET; it does not resubmit
 * model input or credentials. `reason` describes a failed native outcome.
 */
export const SessionRunStatus = z.object({
  run_id: z.string(),
  status: z.enum(["running", "succeeded", "failed"]),
  reason: RunFailureReason.nullable().optional(),
});
export type SessionRunStatus = z.infer<typeof SessionRunStatus>;

/**
 * One settled tool step of one of the session's runs (E-2 #1381).
 *
 * This is the SECOND witness `argument_correctness` scores against. What the
 * SD-9 stream publishes live is the model's own account of the call —
 * `tool-input-available.input` is `toolCall.arguments` verbatim — and an
 * evaluator that compared that with itself would be scoring the agent's
 * self-statement. `params` is what the tool actually executed with after
 * validation and coercion (the `after_tool` effective arguments), which is
 * the environment's record of the same call.
 *
 * `params` is JSON TEXT, for two reasons that agree. It is the shape the
 * original evaluator reads its raw witness in — pydantic-evals'
 * `ArgumentCorrectness` does `json.loads(span.arguments)` — and a tool's
 * arguments are arbitrary JSON, so a schema-less object here would emit a
 * `dict[str, object]` into the generated boundary models, which this repo does
 * not allow.
 */
export const SessionHistoryStep = z.object({
  run_id: z.string(),
  step_index: z.number().int().nonnegative(),
  tool_name: z.string(),
  params: z.string(),
});
export type SessionHistoryStep = z.infer<typeof SessionHistoryStep>;

/**
 * One model call's token and cost accounting (ticket 4 of #1996, #2004).
 *
 * The stream's `data-usage` part stays session-cumulative; this shape is the
 * history read's PER-CALL view of the same `usage` rows pi persists. The field
 * names are snake_case like every other history field, and `cache_write1h` and
 * `reasoning` are deliberately absent: the record the browser and the auditor
 * need is input/output/cache read/cache write/total and the four-way cost.
 */
export const SessionUsage = z.object({
  input: z.number(),
  output: z.number(),
  cache_read: z.number(),
  cache_write: z.number(),
  total_tokens: z.number(),
  cost: z.object({
    input: z.number(),
    output: z.number(),
    cache_read: z.number(),
    cache_write: z.number(),
    total: z.number(),
  }),
});
export type SessionUsage = z.infer<typeof SessionUsage>;

/**
 * One model call of one turn: who answered and what it cost (ticket 4, #2004).
 *
 * `provider` and `model` are read from the assistant entry the call committed.
 * A `translate_anime_title` catalog miss spends a supplemental model call whose
 * usage row hangs on the tool result; that call's identity lives in the tool
 * result's own details, and the read model reads it from there so no usage row
 * is ever returned without the model that produced it.
 */
export const SessionModelCall = z.object({
  provider: z.string(),
  model: z.string(),
  usage: SessionUsage,
});
export type SessionModelCall = z.infer<typeof SessionModelCall>;

/**
 * One tool's recorded result (ticket 4, #2004). Every tool is returned, not
 * only `respond`.
 *
 * `result` is JSON TEXT for the same reason `SessionHistoryStep.params` is: a
 * tool's details are arbitrary JSON, and a schema-less object would emit a
 * `dict[str, object]` into the generated boundary models this repo does not
 * allow. `respond`'s full data — the whole `ChatResponseDataPart`, not only the
 * `intent`/`success` the transcript carries — is read out of this text.
 */
export const SessionToolResult = z.object({
  tool_call_id: z.string(),
  tool_name: z.string(),
  is_error: z.boolean(),
  result: z.string(),
});
export type SessionToolResult = z.infer<typeof SessionToolResult>;

/**
 * The `GET /v1/conversations/{id}/messages` payload (SESSION-1 #959).
 *
 * `run` is additive (W1-5 #1254): `null` when the session has never opened a
 * turn. It is nullable AND optional because both shapes are real. Null is what
 * either server sends for a session with no run — the Python route that serves
 * this path until #1256 flips the fallback flag emits the key too, since its
 * generated model defaults the field to `None` and the route sets no
 * `response_model_exclude_none`. Absent is every payload captured before this
 * field existed, which today's client still has to keep parsing.
 *
 * `steps` is additive on the same terms (E-2 #1381): every settled step of
 * every run of this session, each under the run that numbered it, so a caller
 * pairing a call with its settled params never has to guess which run answered
 * it. Same two absent shapes — null from the Python route, missing from every
 * payload recorded before it existed.
 *
 * `tool_results` and `model_calls` are additive on those same terms (ticket 4
 * of #1996, #2004): the complete per-turn record the transcript alone cannot
 * carry. They are whole-session arrays, not page-scoped, because an auditor
 * reads the turn, not the page. `messages` keeps every field it had, so the web
 * app's history view is untouched.
 */
export const GetSessionHistoryResponse = z.object({
  messages: z.array(SessionHistoryMessage),
  revision: z.number().int().nonnegative(),
  next_offset: z.number().int().nonnegative().nullable(),
  run: SessionRunStatus.nullable().optional(),
  steps: z.array(SessionHistoryStep).nullable().optional(),
  tool_results: z.array(SessionToolResult).nullable().optional(),
  model_calls: z.array(SessionModelCall).nullable().optional(),
});
export type GetSessionHistoryResponse = z.infer<typeof GetSessionHistoryResponse>;

/**
 * One `sessions` row of the `GET /v1/conversations` index (Card E of the
 * #1317 decomposition): the summary the browser sidebar lists, read straight
 * from the table admission owns (`workers/edge/src/agent/admission/session-owner.ts`).
 *
 * `title` and `first_query` are nullable, and the null is a real wire value
 * rather than defensiveness. #1608 taught the native tier to write both — the
 * intake stores the caller's first query verbatim, and the first successful
 * settlement fills `title` with its first 20 characters — but between
 * admission and that settlement the conversation exists with `title` unset,
 * and every row created before #1608 has neither column. A key that is absent
 * instead of null is not a shape this route emits.
 *
 * `created_at`/`updated_at` travel as the database renders them (the driver's
 * own `pg/timestamptz-string@1` text, not a normalised ISO instant) and are
 * nullable because the columns are. The sidebar reads neither: what the
 * payload's order carries — newest `updated_at` first — is the semantic.
 */
export const ConversationListRow = z.object({
  session_id: z.string(),
  title: z.string().nullable(),
  first_query: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});
export type ConversationListRow = z.infer<typeof ConversationListRow>;

/**
 * The `GET /v1/conversations` payload: the caller's own conversations, newest
 * first, capped at the 30 rows the container's `list_sessions` returned
 * before this card moved the route. That cap is the response's own ceiling —
 * the statement hands back at most 30 rows, so a longer body is a defect on
 * this side and is refused rather than forwarded. An array and not an
 * envelope — the browser client parses the top level as a list
 * (`apps/web/src/features/chat/use-conversation-list.ts`), and that is the
 * body it has always been served.
 */
export const ListConversationsResponse = z.array(ConversationListRow).max(30);
export type ListConversationsResponse = z.infer<typeof ListConversationsResponse>;
