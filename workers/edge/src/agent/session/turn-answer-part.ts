/**
 * The `data-response` part one turn's answer becomes (card #1283).
 *
 * Port of `apps/agent`'s `chat_stream_frames.chat_response_wire` ×
 * `response_builder.agent_result_to_response`, and a projection ONLY: every
 * member below is either the intent the server derived, prose the model wrote,
 * or a field of a payload a catalog tool stored. Nothing is re-typed by the
 * model, which is what `_CompactOutput` protected on the Python side.
 *
 * THE SHAPE IS NOT A DECISION OF THIS CARD. `packages/contract`'s
 * `ChatResponseDataPart` is a STRICT zod union — an unknown member fails the
 * whole part in the browser (`apps/web/src/features/chat/data-parts.ts`) — and
 * the recorded captures `apps/agent/tests/fixtures/chat_stream/*.sse` are what
 * the web suite replays. So the wire keys here are Python's `_SEARCH_WIRE_KEYS`
 * / `_ITINERARY_WIRE_KEYS` / `_CANDIDATE_WIRE_KEYS` filters, and the constant
 * members the captures carry (`session`, `route_history`, `errors`) are emitted
 * as the empty values they hold there: `AGENT_TURN_ROUTE` is a FALLBACK flag, so
 * a client must not be able to tell which tier answered it — this tier may
 * neither invent a member nor drop one.
 *
 * Two members Python carries are absent, each for a reason that is written
 * down elsewhere: `clarification_id` (Python's `pending.revision`, deliberately
 * not ported — `turn-instructions.ts` explains that the TS tier has no
 * selection path for the counter to guard) and `debug` (opt-in step dumps, and
 * the TS tier has no debug flag). Both are optional in the contract.
 */
import type { Point, TimedItinerary } from "@animichi/contract";
import type { ChatResponseIntent } from "@animichi/contract/agent-tool-schemas";
import type {
  ItineraryPayload,
  OrderedCandidate,
  SearchResultPayload,
} from "../tools/catalog-tool-session.ts";
import type { PendingClarification } from "./session-envelope.ts";
import type { AnswerPayload, TurnAnswer } from "./turn-answer.ts";

/** A stored search result, filtered to the members the part publishes. */
interface SearchResultsWire {
  kind: "bangumi" | "nearby";
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

/** The `data` member, whose shape the intent decides. */
type AnswerData =
  | { results: SearchResultsWire }
  | { itinerary: ItineraryWire }
  | { reason: string; candidates: CandidateWire[] }
  | Record<string, never>;

/** The part itself, as `ChatResponseDataPart` accepts it. */
export interface ChatResponsePart {
  intent: ChatResponseIntent;
  success: boolean;
  status: string;
  message: string;
  data: AnswerData;
  session: Record<string, never>;
  route_history: never[];
  errors: never[];
  ui?: { component: string };
}

/** Python's `_UI_MAP`, for the intents this tier can produce. */
const UI_COMPONENTS: Partial<Record<ChatResponseIntent, string>> = {
  search_bangumi: "PilgrimageGrid",
  search_nearby: "NearbyMap",
  plan_route: "RoutePlannerWizard",
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

function clarificationWire(pending: PendingClarification): AnswerData {
  return { reason: pending.reason, candidates: pending.candidates.map(candidateWire) };
}

/**
 * The `data` member and the status it implies, from ONE walk of the payload.
 *
 * Python computed them apart (`_wire_data`, then `_response_status` reading
 * back out of the dict it had just built), and that is the same cascade twice
 * over the same value. Here the tag is walked once: the status of a search or a
 * route IS the status the wire object already carries, and a clarification's is
 * the constant Python's own branch returned.
 */
function published(payload: AnswerPayload): { data: AnswerData; status: string } {
  if (payload.of === "clarification") {
    return { data: clarificationWire(payload.clarification), status: "needs_clarification" };
  }
  if (payload.of === "route") {
    const itinerary = itineraryWire(payload.itinerary);
    return { data: { itinerary }, status: itinerary.status };
  }
  if (payload.of === "search") {
    const results = searchResultsWire(payload.search);
    return { data: { results }, status: results.status };
  }
  return { data: {}, status: "info" };
}

/**
 * One answer as the `data-response` part carries it.
 *
 * `success` is unconditionally true because this projection is only ever
 * reached on a turn that SUCCEEDED — a failed turn emits the captures' `error`
 * frame instead and never a part at all (`turn-frames.ts`).
 */
export function chatResponsePart(answer: TurnAnswer): ChatResponsePart {
  const component = UI_COMPONENTS[answer.intent];
  const { data, status } = published(answer.payload);
  return {
    intent: answer.intent,
    success: true,
    status,
    message: answer.message,
    data,
    session: {},
    route_history: [],
    errors: [],
    ...(component === undefined ? {} : { ui: { component } }),
  };
}
