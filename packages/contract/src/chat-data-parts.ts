import { z } from "zod";
import {
  AnimeCandidate,
  Itinerary,
  Point,
  ResolveOutcome,
  TimedItinerary,
} from "./models.js";

const StreamPoint = Point.partial().extend({
  lat: z.number().optional(),
  lng: z.number().optional(),
  ep: z.number().int().optional(),
}).strict();

const SearchResults = z.object({
  kind: z.enum(["bangumi", "nearby", "multi"]).optional(),
  bangumi_id: z.union([z.string(), z.number().int()]).optional(),
  title: z.string().optional(),
  row_count: z.number().int().nonnegative().optional(),
  status: z.string().optional(),
  strategy: z.string().optional(),
  summary: z.record(z.string(), z.unknown()).optional(),
  rows: z.array(StreamPoint).optional(),
}).strict();

const StreamItinerary = Itinerary.partial().extend({
  ordered_points: z.union([z.array(z.string()), z.array(StreamPoint)]).optional(),
  point_count: z.number().int().nonnegative().optional(),
  status: z.string().optional(),
  total_walk_minutes: z.number().nonnegative().optional(),
  timed_itinerary: TimedItinerary.optional(),
}).strict();

const ClarificationCandidate = AnimeCandidate.partial().extend({
  id: z.string().optional(),
  cover_url: z.string().nullable().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
}).strict();

const ClarificationData = z.object({
  reason: z.string().optional(),
  clarification_id: z.number().int().optional(),
  candidates: z.array(ClarificationCandidate).optional(),
  outcome: ResolveOutcome.optional(),
}).strict();

const SearchData = z.object({ results: SearchResults.optional() }).strict();
const RouteData = z.object({
  results: SearchResults.optional(),
  itinerary: StreamItinerary.optional(),
}).strict();
const EmptyData = z.object({}).strict();

const PublicAPIError = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

const ResponseEnvelope = z.object({
  success: z.boolean().optional(),
  status: z.string().optional(),
  session_id: z.string().nullable().optional(),
  /** The Session revision echoed for the next turn (TURN-4 #955): the web
   * sends it back as `x-session-revision` so admission CAS can reject stale
   * concurrent turns. */
  revision: z.number().int().optional(),
  /** The matching Session offer (TURN-4 #955): sha256 of the persisted
   * session envelope, echoed so the web can send `x-session-digest`. */
  session_digest: z.string().optional(),
  message: z.string().optional(),
  session: z.record(z.string(), z.unknown()).optional(),
  route_history: z.array(z.record(z.string(), z.unknown())).optional(),
  errors: z.array(PublicAPIError).optional(),
  ui: z.object({ component: z.string() }).nullable().optional(),
  generated_title: z.string().nullable().optional(),
  debug: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict();

const searchPart = (intent: "search_bangumi" | "search_nearby") =>
  ResponseEnvelope.extend({ intent: z.literal(intent), data: SearchData.optional() });

const itineraryPart = (intent: "plan_route" | "plan_selected" | "plan_multi") =>
  ResponseEnvelope.extend({ intent: z.literal(intent), data: RouteData.optional() });

const prosePart = (intent: "general_qa" | "greet_user" | "blocked") =>
  ResponseEnvelope.extend({ intent: z.literal(intent), data: EmptyData.optional() });

export const ChatResponseDataPart = z.discriminatedUnion("intent", [
  searchPart("search_bangumi"),
  searchPart("search_nearby"),
  itineraryPart("plan_route"),
  itineraryPart("plan_selected"),
  itineraryPart("plan_multi"),
  prosePart("general_qa"),
  prosePart("greet_user"),
  ResponseEnvelope.extend({ intent: z.literal("clarify"), data: ClarificationData.optional() }),
  ResponseEnvelope.extend({ intent: z.literal("partial"), data: RouteData.optional() }),
  prosePart("blocked"),
  ResponseEnvelope.extend({ intent: z.literal("error"), data: EmptyData.optional() }),
  ResponseEnvelope.extend({ intent: z.literal("unknown"), data: EmptyData.optional() }),
]);

export const ChatDataPartSchema = ChatResponseDataPart;
export type ChatDataPart = z.infer<typeof ChatDataPartSchema>;
export type ChatResponseDataPart = z.infer<typeof ChatResponseDataPart>;
