/**
 * The body a frozen trajectory prefix is seeded with (E-1 #1380, spec §十 10.1).
 *
 * A prefix is the FIRST turn of a session, supplied rather than run: the user
 * message that opened it, the one tool call it made with the result that call
 * settled, the answer it ended on, and the session state it left behind. An
 * eval case that measures a REPLY — a pick answering a clarification the agent
 * never got to ask — has no starting point on an HTTP tier, because the only
 * way to put a turn in a session is to have taken it. This is the way to put
 * one there without taking it (李博杰《深入理解 AI Agent》ch.7,
 * `initialization_actions`).
 *
 * WHY THE SHAPE IS FLAT AND EXPLICIT rather than "replay this recorded turn":
 * the seeding writes through the product's own store code
 * (`workers/edge/src/agent/session/prefix-seeding.ts`), and every member below
 * lands in exactly one column — `messages.content`, `run_steps.tool_name`,
 * `run_steps.input`, `run_steps.result`, and the Durable Object's envelope key.
 * A member with no such landing place would be a member nothing reads.
 *
 * `params` and `result_details` are JSON TEXT for the reason
 * `SessionHistoryStep.params` is (E-2 #1381): a tool's arguments are arbitrary
 * JSON, and a schema-less object here would emit a `dict[str, object]` into any
 * generated model — which this repo does not allow. Nothing generates from this
 * module today; the rule holds anyway, because the day something does is not the
 * day to discover the shape was never allowed.
 *
 * NOT EMITTED, ON PURPOSE. The procedure is mounted only where
 * `APP_ENV === "staging"` (`staging-prefix-path.ts` explains why the path is
 * absent from `AGENT_PATHS`), so no OpenAPI document and no Python boundary
 * model names it. `packages/eval` is the one consumer, and it parses its own
 * request through these schemas so a harness cannot send a body the edge would
 * refuse to read.
 */

import { z } from "zod";

/**
 * One choice a clarification offered, as `OrderedCandidate` carries it
 * (`workers/edge/src/agent/tools/catalog-tool-session.ts`). `id` and `title`
 * are required and the five optional members are the ones a place candidate
 * needs; the edge re-checks every one of them on the way into storage
 * (`durable-envelope-store.ts::storedCandidate`), so a half-readable candidate
 * is never a candidate.
 */
export const SeededCandidate = z.object({
  id: z.string().min(1),
  title: z.string(),
  cover_url: z.string().optional(),
  points_count: z.number().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  effective_radius_m: z.number().optional(),
});
export type SeededCandidate = z.infer<typeof SeededCandidate>;

/**
 * The question the seeded turn ended on, and the id a reply must name.
 *
 * `id` is supplied rather than minted because it is the whole point of the
 * seed: a case's pick carries `clarification_id`, and
 * `validateCandidateSelection` refuses a pick whose id is not the open
 * question's own (`candidate-selection.ts`, rule 2). The envelope is built with
 * this value as both the pending id AND the session's clarification revision,
 * so the next question a real turn asks is strictly greater and no reply can
 * ever validate against two of them.
 */
export const SeededClarification = z.object({
  id: z.number().int().positive(),
  reason: z.string().min(1),
  candidates: z.array(SeededCandidate).min(1),
});
export type SeededClarification = z.infer<typeof SeededClarification>;

/** The work the seeded session is already about, or none. */
export const SeededCurrentAnime = z.object({
  bangumi_id: z.string().min(1),
  title: z.string(),
});
export type SeededCurrentAnime = z.infer<typeof SeededCurrentAnime>;

/**
 * The one tool call the seeded turn made, with the result it settled.
 *
 * The RESULT is the load-bearing half. `turn-transcript.ts` rebuilds a
 * session's transcript by answering each stored tool-call message from the
 * `run_steps` rows of the run that issued it; a prefix written without the
 * settled row would leave the model an unanswered call, and the rebuild drops
 * an earlier run's unanswered message entirely — so the model would re-derive
 * the call this prefix exists to have already made.
 */
export const SeededToolCall = z.object({
  tool_name: z.string().min(1),
  /** `run_steps.input` — what the tool executed with, as JSON text. */
  params: z.string(),
  /** The text the model read back, which becomes the step's `content`. */
  result_text: z.string(),
  /** `run_steps.result.details` as JSON text, or absent for no details. */
  result_details: z.string().optional(),
});
export type SeededToolCall = z.infer<typeof SeededToolCall>;

/**
 * One frozen prefix.
 *
 * `case_id` is the IDEMPOTENCY key, not a label: it becomes the seeded user
 * message's `client_message_id`, so the intake's own partial unique index
 * (`messages_session_client_message_id`) decides whether a second seeding
 * writes anything — the same mechanism a repeated `POST /v1/chat` is deduped
 * by. A re-run of the same case against the same session therefore answers
 * `seeded: false` and changes nothing.
 */
export const SeedTrajectoryPrefixRequest = z.object({
  case_id: z.string().min(1),
  user_text: z.string().min(1),
  tool_call: SeededToolCall,
  assistant_text: z.string().min(1),
  pending_clarification: SeededClarification.nullable(),
  current_anime: SeededCurrentAnime.nullable(),
});
export type SeedTrajectoryPrefixRequest = z.infer<typeof SeedTrajectoryPrefixRequest>;

/**
 * What the procedure answers. `seeded` is false when the case's prefix was
 * already there — the idempotent answer, which is a success and not a refusal.
 *
 * It names no run. The run a prefix opens is settled and closed before this
 * answer is written, and the only handle a caller needs afterwards is the
 * session — which is what `GET /v1/conversations/{id}/messages` reads the
 * seeded transcript back by. A run id on the idempotent branch could only be
 * "the session's latest run", which after the measured turn is a different run
 * entirely; publishing a field that means two things is worse than not having it.
 */
export const SeedTrajectoryPrefixResponse = z.object({
  session_id: z.string(),
  seeded: z.boolean(),
});
export type SeedTrajectoryPrefixResponse = z.infer<typeof SeedTrajectoryPrefixResponse>;
