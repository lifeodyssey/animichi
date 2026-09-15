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
 * (`apps/agent/.../get_session_history.py` and
 * `workers/edge/src/agent/views/`). `agent-contract.ts` keeps the shapes that
 * have no such home — health, the turn request, photo search.
 *
 * The transcript shapes are emitted like every other boundary model:
 * `scripts/emit-agent-python.ts` reads these declarations,
 * `test/agent-boundary.test.ts` fails on drift, and
 * `packages/contract/src/index.ts` re-exports them so the root import path is
 * unchanged. The list shapes below are deliberately NOT emitted: the route
 * they describe is edge-owned (`agent-paths.ts` marks it `runtime: "edge"`) and
 * the FastAPI list route was deleted with it, so there is no Python route for a
 * generated model to serve — the position the native stream boundary already
 * holds.
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
 * verbatim (`migrations/neon/20260902000000_agent_runs.sql`). Bounded on
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
 */
export const GetSessionHistoryResponse = z.object({
  messages: z.array(SessionHistoryMessage),
  revision: z.number().int().nonnegative(),
  next_offset: z.number().int().nonnegative().nullable(),
  run: SessionRunStatus.nullable().optional(),
  steps: z.array(SessionHistoryStep).nullable().optional(),
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
