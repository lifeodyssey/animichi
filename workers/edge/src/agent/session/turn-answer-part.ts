/**
 * The `data-response` part one turn's answer becomes (card #1283).
 *
 * Port of `apps/agent`'s `chat_stream_frames.chat_response_wire` ×
 * `response_builder.agent_result_to_response`, and a projection ONLY: every
 * member below is either the intent the server derived, prose the model wrote,
 * or a field of a payload a catalog tool stored. Nothing is re-typed by the
 * model, which is what `_CompactOutput` protected on the Python side.
 *
 * THE RETURN TYPE IS THE CONTRACT'S OWN UNION, not a local restatement of it.
 * A local `{intent: ChatResponseIntent; data: …}` pair would type-check every
 * wrong pairing there is — `plan_route` carrying clarification data, `clarify`
 * carrying search rows — because nothing would tie the two members together.
 * Returning `ChatResponseDataPart` makes each branch below prove its own
 * pairing at compile time; `turn-answer-part.type-test.ts` pins that a wrong
 * one does not compile, and `packages/contract/test/chat-answer-part.test.ts`
 * still parses what is actually emitted, because a type cannot check the
 * VALUES (`status`, the wire-key filters) the way the zod does.
 *
 * THE SHAPE IS NOT A DECISION OF THIS CARD. `ChatResponseDataPart` is a STRICT
 * zod union — an unknown member fails the
 * whole part in the browser (`apps/web/src/features/chat/data-parts.ts`) — and
 * the recorded captures `apps/agent/tests/fixtures/chat_stream/*.sse` are what
 * the web suite replays. So the wire keys here are Python's `_SEARCH_WIRE_KEYS`
 * / `_ITINERARY_WIRE_KEYS` / `_CANDIDATE_WIRE_KEYS` filters, and the constant
 * members the captures carry (`session`, `route_history`, `errors`) are emitted
 * as the empty values they hold there: `AGENT_TURN_ROUTE` is a FALLBACK flag, so
 * a client must not be able to tell which tier answered it — this tier may
 * neither invent a member nor drop one.
 *
 * One member Python carries is still absent: `debug` (opt-in step dumps, and
 * the TS tier has no debug flag). It is optional in the contract.
 *
 * `clarification_id` came BACK with #1288. #1283 left it out because nothing on
 * this tier could answer a clarification, so the counter guarded nothing; now
 * `src/agent/selection/` answers one, and the id is how a pick names the
 * question it belongs to — publishing it is what closes that round trip
 * (`apps/web`'s `ClarifyCard` reads `data.clarification_id` and sends it back).
 */
import type { ChatResponseDataPart, Point, TimedItinerary } from "@animichi/contract";
import type {
  ItineraryPayload,
  OrderedCandidate,
  SearchResultPayload,
} from "../tools/catalog-tool-session.ts";
import type { PendingClarification } from "./session-envelope.ts";
import type { AnsweredIntent, SelectionAnswer, TurnAnswer } from "./turn-answer.ts";

/** A stored search result, filtered to the members the part publishes. */
interface SearchResultsWire {
  kind: SearchResultPayload["kind"];
  bangumi_id?: string;
  title?: string;
  row_count: number;
  status: string;
  strategy: string;
  summary: { count: number; source: string };
  rows: Point[];
}

/** A planned route, filtered to the members the part publishes. */
interface ItineraryWire {
  ordered_points: Point[];
  point_count: number;
  status: string;
  timed_itinerary: TimedItinerary;
}

/** One offered choice, stripped of the fields only the tools use. */
interface CandidateWire {
  id: string;
  title: string;
  cover_url?: string;
  points_count?: number;
  lat?: number;
  lng?: number;
}

/**
 * Python's `_UI_MAP`, TOTAL over the intents this tier can derive.
 *
 * Total rather than partial on purpose: `AnsweredIntent` is `TurnAnswer`'s own
 * discriminant union, so adding a member the map has no card for is a compile
 * error rather than a part that silently ships without a renderer.
 */
const UI_COMPONENTS: Record<AnsweredIntent, string> = {
  search_bangumi: "PilgrimageGrid",
  search_nearby: "NearbyMap",
  plan_route: "RoutePlannerWizard",
  plan_selected: "RoutePlannerWizard",
  plan_multi: "RoutePlannerWizard",
  general_qa: "GeneralAnswer",
  greet_user: "GeneralAnswer",
  clarify: "Clarification",
};

/** Python's `"ok" if row_count/ordered_points else "empty"`. */
function countStatus(count: number): string {
  return count > 0 ? "ok" : "empty";
}

function searchResultsWire(payload: SearchResultPayload): SearchResultsWire {
  return {
    kind: payload.kind,
    bangumi_id: payload.anime_id ?? undefined,
    title: payload.metadata?.anime_title,
    row_count: payload.row_count,
    status: countStatus(payload.row_count),
    strategy: payload.kind === "nearby" ? "geo" : "bangumi",
    summary: { count: payload.row_count, source: "catalog" },
    rows: payload.rows,
  };
}

function itineraryWire(payload: ItineraryPayload): ItineraryWire {
  return {
    ordered_points: payload.ordered_points,
    point_count: payload.ordered_points.length,
    status: countStatus(payload.ordered_points.length),
    timed_itinerary: payload.timed_itinerary,
  };
}

function candidateWire(candidate: OrderedCandidate): CandidateWire {
  const { id, title, cover_url, points_count, lat, lng } = candidate;
  return { id, title, cover_url, points_count, lat, lng };
}

function clarificationWire(pending: PendingClarification) {
  return {
    reason: pending.reason,
    clarification_id: pending.id,
    candidates: pending.candidates.map(candidateWire),
  };
}

/** The `data` of a selection answer: whichever payloads it managed to produce.
 * Python emitted `{"results": …, "itinerary": …}` for every route-shaped intent
 * and compacted the absent halves away (`chat_stream_frames._wire_data`), which
 * is the same rule stated as a build rather than a filter. */
function selectionData(answer: Exclude<SelectionAnswer, { of: "refused" }>) {
  const search = answer.of === "selected" ? null : answer.search;
  const itinerary = answer.of === "place" ? null : answer.itinerary;
  return {
    ...(search ? { results: searchResultsWire(search) } : {}),
    ...(itinerary ? { itinerary: itineraryWire(itinerary) } : {}),
  };
}

/** The members the captures carry between `intent` and `data`. */
function outcome(answer: TurnAnswer, status: string) {
  return { success: true, status, message: answer.message };
}

/** The members every capture carries after `data`, constant on every part. */
function capturedMembers(intent: AnsweredIntent) {
  return { session: {}, route_history: [], errors: [], ui: { component: UI_COMPONENTS[intent] } };
}

/** Python's `invalid_selection` error entry, the one `errors` member this tier
 * emits. The sentence is the refusal's OWN (`selection-copy.ts`) rather than
 * the registry's generic "Invalid selection.": Python minted a specific text in
 * `validate_candidate_selection` and then dropped it on the floor
 * (`_invalid_selection_response` ignores its argument), and telling a visitor
 * that their choice expired is the whole point of having written it. */
const INVALID_SELECTION = "invalid_selection";

/**
 * One deterministic selection as its part (#1288).
 *
 * The one place `success` is not the constant below: a selection turn SUCCEEDS
 * as a run — it did exactly what it was asked and has nothing to retry — while
 * still reporting that the catalog had no spots for the works picked. Python
 * drew the same distinction with `success_override`, and the browser needs it:
 * `chat_stream_frames._is_failure` reads `success` together with `status` to
 * decide whether the stream finishes `stop` or `error`.
 */
function selectionPart(answer: SelectionAnswer): ChatResponseDataPart {
  const envelope = { success: answer.success, status: answer.status, message: answer.message };
  if (answer.of === "refused") return refusedPart(envelope);
  return { intent: answer.intent, ...envelope, data: selectionData(answer), ...capturedMembers(answer.intent) };
}

/** A pick the session could not accept, in Python's own error shape. */
function refusedPart(envelope: { success: boolean; status: string; message: string }): ChatResponseDataPart {
  const errors = [{ code: INVALID_SELECTION, message: envelope.message, details: {} }];
  return { intent: "clarify", ...envelope, data: { candidates: [] }, ...capturedMembers("clarify"), errors };
}

/**
 * One answer as the `data-response` part carries it.
 *
 * `success` is true on every MODEL-answered part because that projection is
 * only ever reached on a turn that SUCCEEDED — a failed turn emits the
 * captures' `error` frame instead and never a part at all (`turn-frames.ts`).
 * A selection carries its own verdict; see `selectionPart`.
 */
export function chatResponsePart(answer: TurnAnswer): ChatResponseDataPart {
  const tail = capturedMembers(answer.intent);
  if (answer.of === "clarification") {
    const data = clarificationWire(answer.clarification);
    return { intent: answer.intent, ...outcome(answer, "needs_clarification"), data, ...tail };
  }
  if (answer.of === "route") {
    const itinerary = itineraryWire(answer.itinerary);
    return { intent: answer.intent, ...outcome(answer, itinerary.status), data: { itinerary }, ...tail };
  }
  if (answer.of === "search") {
    const results = searchResultsWire(answer.search);
    return { intent: answer.intent, ...outcome(answer, results.status), data: { results }, ...tail };
  }
  if (answer.of === "prose") return { intent: answer.intent, ...outcome(answer, "info"), data: {}, ...tail };
  return selectionPart(answer);
}
