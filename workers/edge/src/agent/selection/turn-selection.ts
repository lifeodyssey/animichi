/**
 * The turn a selection IS (card #1288, spec §三).
 *
 * A selection turn skips the model loop entirely — Python routed one straight
 * to a handler (`public_api._kind_from_request` → `_point_turn` /
 * `_candidate_turn`, never `_text_turn`) — so what is left is exactly this:
 * validate the pick against the session's open question, run the one step it
 * implies, and answer.
 *
 * IT RUNS AS A TURN STEP, and that is the card's structural point. Spec §三
 * names route persistence as the example of a side effect that must accept the
 * `(run_id, step_index)` idempotency key, and a selection is nothing BUT that
 * side effect: no provider call, one catalog call, an itinerary stored. Putting
 * it through `TurnSteps` means an evicted alarm replays the settled record
 * rather than re-planning the route, on the same machinery a model tool call
 * already uses.
 *
 * The VALIDATION deliberately sits outside the step. It reads the session
 * envelope, which is per-session state a replay reloads for itself, so
 * persisting a verdict about it would be persisting an answer to a question
 * that may have changed — and it costs nothing to re-decide.
 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@earendil-works/pi-ai";
import { asJsonValue } from "../session/turn-store.ts";
import type { CatalogClient } from "../tools/catalog-client.ts";
import type { SelectionAnswer, TurnAnswer } from "../session/turn-answer.ts";
import type { TurnCatalogSession } from "../session/turn-catalog-session.ts";
import { serverStepFailed, serverStepOpened, serverStepSettled } from "../session/turn-frames.ts";
import type { TurnFrameSink } from "../session/turn-subscribers.ts";
import type { TurnSteps } from "../session/turn-step.ts";
import { SelectionRefused, validateCandidateSelection } from "./candidate-selection.ts";
import { MULTI_SELECTION_STEP, multiSelectionAnswer, multiSelectionRecord } from "./multi-selection.ts";
import {
  PLACE_SELECTION_STEP,
  placeSelectionAnswer,
  placeSelectionRecord,
  stagedPlace,
} from "./place-selection.ts";
import { SELECTED_ROUTE_STEP, selectedItineraryAnswer, selectedItineraryRecord } from "./selected-itinerary.ts";
import { SELECTION_ERROR, recordIn, type SelectionRecord } from "./selection-record.ts";
import type { SelectionRequest } from "./selection-request.ts";

/** What one selection turn needs to answer itself. */
export interface TurnSelectionParts {
  readonly catalog: CatalogClient;
  /** The turn's own state: the envelope it validates against, and the registry
   * the answer's payloads are stored in. */
  readonly session: TurnCatalogSession;
  /** The `(run_id, step_index)` sequence this selection's step joins. */
  readonly steps: TurnSteps;
  readonly emit: TurnFrameSink;
}

/** One selection step's work, which must answer its own failures. */
type SelectionWork = () => Promise<SelectionRecord>;

/** Python's `new_step_call_id`: `f"{tool}-{uuid4()}"`. Frames are never
 * persisted (§三), so a fresh id per attempt is the honest one. */
function stepCallId(toolName: string): string {
  return `${toolName}-${crypto.randomUUID()}`;
}

/** One record as a tool result: the same "one value, two readers" shape
 * `outcome-tool-result.ts` gives a catalog tool — the text is what a model
 * would read and the details are what `run_steps.result` stores and replays. */
function asToolResult(record: SelectionRecord): AgentToolResult<JsonValue> {
  return { content: [{ type: "text", text: JSON.stringify(record) }], details: asJsonValue(record) };
}

/** The frames one settled step closes with, told apart by its own status. */
function settledFrames(callId: string, record: SelectionRecord) {
  return record.status === SELECTION_ERROR ? serverStepFailed(callId) : serverStepSettled(callId, record.status);
}

/**
 * One selection step: streamed, numbered, replayable.
 *
 * The frames bracket the step on BOTH paths, replay included, because a client
 * that reconnected mid-turn is watching this attempt and knows nothing about
 * the one that was evicted.
 */
async function stepped(
  parts: TurnSelectionParts,
  toolName: string,
  input: JsonValue,
  work: SelectionWork,
): Promise<SelectionRecord> {
  const callId = stepCallId(toolName);
  await parts.emit(serverStepOpened(callId, toolName));
  const settled = await parts.steps.take(toolName, input, async () => asToolResult(await work()));
  const record = recordIn(settled.details);
  await parts.emit(settledFrames(callId, record));
  return record;
}

/** `selected_point_ids`: route what the user ticked, no question involved. */
async function pointTurn(
  parts: TurnSelectionParts,
  request: Extract<SelectionRequest, { of: "points" }>,
): Promise<SelectionAnswer> {
  const { catalog, session } = parts;
  const { pointIds, origin, locale } = request;
  const input = { point_ids: [...pointIds], origin };
  const record = await stepped(parts, SELECTED_ROUTE_STEP, input, () =>
    selectedItineraryRecord(catalog, pointIds, origin, locale));
  return selectedItineraryAnswer(session, record, locale);
}

/** The `anime_ambiguity` half: several works merged into one route. */
async function multiTurn(
  parts: TurnSelectionParts,
  picked: readonly string[],
  candidates: TurnCatalogSession["envelope"]["pendingClarification"],
  locale: string,
): Promise<SelectionAnswer> {
  const offered = candidates?.candidates ?? [];
  const input = { candidate_ids: [...picked] };
  const record = await stepped(parts, MULTI_SELECTION_STEP, input, () =>
    multiSelectionRecord(parts.catalog, picked, offered, locale));
  return multiSelectionAnswer(parts.session, record, picked, locale);
}

/** The `place_ambiguity` half: the one place, searched from its staged pin. */
async function placeTurn(
  parts: TurnSelectionParts,
  picked: string,
  candidates: TurnCatalogSession["envelope"]["pendingClarification"],
  locale: string,
): Promise<SelectionAnswer> {
  const place = stagedPlace(candidates?.candidates ?? [], picked);
  const input = { candidate_id: picked, radius_m: place.radiusM };
  const record = await stepped(parts, PLACE_SELECTION_STEP, input, () =>
    placeSelectionRecord(parts.catalog, place, locale));
  return placeSelectionAnswer(parts.session, record, locale);
}

/** `selected_candidate_ids`: the pick, judged, then run on its own path. */
async function candidateTurn(
  parts: TurnSelectionParts,
  request: Extract<SelectionRequest, { of: "candidates" }>,
): Promise<SelectionAnswer> {
  const pending = parts.session.envelope.pendingClarification;
  const validated = validateCandidateSelection(pending, request.candidateIds, request.clarificationId);
  const { candidateIds, mode } = validated;
  if (mode === "anime_ambiguity") return await multiTurn(parts, candidateIds, pending, request.locale);
  return await placeTurn(parts, candidateIds[0] ?? "", pending, request.locale);
}

/** A pick the session cannot accept, carrying its own words to the visitor. */
function refusedAnswer(message: string): SelectionAnswer {
  return { of: "refused", intent: "clarify", status: "invalid_request", success: false, message };
}

/**
 * One selection request, answered.
 *
 * A `SelectionRefused` is an ANSWER rather than a failed run: the turn did
 * everything asked of it and the pick was the thing that was wrong, so failing
 * the run would refund a quota reservation for work that was done and tell the
 * visitor nothing. Python drew the same line —
 * `TurnSelectionError` produced a 400-shaped response body, not a 500.
 */
export async function answerSelection(
  parts: TurnSelectionParts,
  request: SelectionRequest,
): Promise<TurnAnswer> {
  try {
    if (request.of === "points") return await pointTurn(parts, request);
    return await candidateTurn(parts, request);
  } catch (error) {
    if (error instanceof SelectionRefused) return refusedAnswer(error.message);
    throw error;
  }
}
