/**
 * Agent boundary contract — health/service-metadata wire shapes plus the
 * complete Agent HTTP path inventory (CONTRACT-1, #938).
 *
 * The Agent (FastAPI container) publishes these shapes directly as JSON; the
 * TS contract owns them so the Python side consumes generated models instead
 * of handwritten wire mirrors. Future capability cards extend this file's
 * models and migrate their route in the same PR — paths may appear here as
 * inventory entries before their model is generated (spec rule 7).
 */

import { z } from "zod";

/** The `/healthz` payload: identity + build + runtime surface of the agent. */
export const ServiceMetadata = z.object({
  status: z.literal("ok"),
  service: z.string(),
  git_commit: z.string(),
  git_branch: z.string(),
  started_at: z.string(),
  app_env: z.string(),
  observability_enabled: z.boolean(),
  db_adapter: z.string(),
  session_store: z.string(),
});
export type ServiceMetadata = z.infer<typeof ServiceMetadata>;

/** The `GET /` payload: service banner and its endpoint map. */
export const EndpointMap = z.object({
  healthz: z.string(),
  runtime: z.string(),
  feedback: z.string(),
});
export type EndpointMap = z.infer<typeof EndpointMap>;

export const RootMetadata = z.object({
  service: z.string(),
  status: z.literal("ok"),
  app_env: z.string(),
  endpoints: EndpointMap,
});
export type RootMetadata = z.infer<typeof RootMetadata>;

/**
 * The `POST /v1/byok/probe` success body (D5, #953): one bounded
 * vision-capability probe's verdict. `error_code` is a null-or-opaque-string
 * field — the server deliberately collapses every non-auth failure to
 * `provider_unreachable`, so the emitted Pydantic model must keep it nullable
 * rather than optional (a `null` and an absent key are different wires).
 */
export const ByokProbeResponse = z.object({
  vision: z.boolean(),
  reachable: z.boolean(),
  error_code: z.string().nullable(),
});
export type ByokProbeResponse = z.infer<typeof ByokProbeResponse>;

/** The agent error envelope (`_error_response`) the probe route shares with
 * every other `/v1` route: `{"error": {"code", "message"}}`. */
export const ByokProbeErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
  }),
});
export type ByokProbeErrorBody = z.infer<typeof ByokProbeErrorBody>;

/**
 * The `POST /v1/chat` turn request (TURN-4 #955): the post-envelope turn
 * carrier built by the route from the AI SDK message envelope plus headers.
 * Every field is optional except `text` so the emitted Pydantic model can
 * validate one turn without the web shipping defaults. Selection turns ride
 * the AI SDK envelope (`chat-data-parts.ts`); the typed turn kinds live in
 * `application/agent_turn.py`, not on this wire.
 */
export const ChatTurnRequest = z.object({
  text: z.string(),
  session_id: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  locale: z.enum(["ja", "zh", "en"]).optional(),
  include_debug: z.boolean().optional(),
  origin: z.string().nullable().optional(),
  origin_lat: z.number().optional(),
  origin_lng: z.number().optional(),
});
export type ChatTurnRequest = z.infer<typeof ChatTurnRequest>;

/** One published Agent path in the complete inventory. */
export interface AgentPath {
  method: "GET" | "POST" | "PATCH";
  path: string;
  summary: string;
}

// ---------------------------------------------------------------------------
// Photo search boundary (AGENT-1 #952).
//
// SearchPhoto and ConfirmPhotoOffer own recognition, the sessionless
// candidate-offer namespace, confirmation, quota, BYOK, and usage policy; the
// wire shapes below are the generated boundary those use cases publish.
// `offer_id` is an opaque server-issued identifier for the candidate-offer
// namespace — never a Session identifier, and never client-derivable.
// ---------------------------------------------------------------------------

/** 8 MiB image cap (matches the web pre-check); base64 expands ceil(n/3)*4. */
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_IMAGE_BASE64_CHARS = Math.floor((PHOTO_MAX_BYTES + 2) / 3) * 4;
// The request schema caps at 2x as a parse-time belt; the semantic limit is
// the 1x cap enforced by SearchPhoto's own 413 rejection.
const PHOTO_IMAGE_BASE64_PARSE_BELT = 2 * PHOTO_IMAGE_BASE64_CHARS;

export const GpsPoint = z.object({
  lat: z.number(),
  lng: z.number(),
});
export type GpsPoint = z.infer<typeof GpsPoint>;

export const PhotoSearchRequest = z.object({
  image_base64: z.string().min(1).max(PHOTO_IMAGE_BASE64_PARSE_BELT),
  mime_type: z.string(),
  gps: GpsPoint.nullable().optional(),
});
export type PhotoSearchRequest = z.infer<typeof PhotoSearchRequest>;

export const PhotoCandidate = z.object({
  id: z.string(),
  title: z.string(),
  bangumi_id: z.string().nullable().optional(),
});
export type PhotoCandidate = z.infer<typeof PhotoCandidate>;

export const PhotoPoint = z.object({
  id: z.string(),
  name: z.string(),
  bangumi_id: z.string(),
  episode: z.number().int(),
  screenshot_url: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  title: z.string(),
  city: z.string().nullable().optional(),
});
export type PhotoPoint = z.infer<typeof PhotoPoint>;

export const PhotoResults = z.object({
  kind: z.literal("bangumi"),
  bangumi_id: z.string(),
  title: z.string(),
  row_count: z.number().int().nonnegative(),
  rows: z.array(PhotoPoint),
});
export type PhotoResults = z.infer<typeof PhotoResults>;

/** One photo-response payload; only the branch fields actually set serialize. */
export const PhotoSearchData = z.object({
  results: PhotoResults.nullable().optional(),
  reason: z.enum(["photo_unrecognized", "photo_ambiguous"]).nullable().optional(),
  candidates: z.array(PhotoCandidate).optional(),
});
export type PhotoSearchData = z.infer<typeof PhotoSearchData>;

export const PhotoSearchResponse = z.object({
  success: z.literal(true),
  status: z.literal("ok"),
  intent: z.enum(["search_bangumi", "clarify"]),
  offer_id: z.string(),
  data: PhotoSearchData,
});
export type PhotoSearchResponse = z.infer<typeof PhotoSearchResponse>;

export const PhotoConfirmRequest = z.object({
  offer_id: z.string().min(1),
  candidate_id: z.string().nullable().optional(),
});
export type PhotoConfirmRequest = z.infer<typeof PhotoConfirmRequest>;

// ---------------------------------------------------------------------------
// Session-history boundary (SESSION-1 #959).
//
// GetSessionHistory is the Agent-owned generated boundary over the current
// Session/Message adapter: one bounded page of the session transcript plus
// the session revision (the monotonic turn-reservation counter the client
// uses as its CAS token for recovery reads) and the next page cursor.
// `response_data` keeps the persistence envelope (intent/success) typed while
// tolerating a wire `null`; extra envelope keys are intentionally not part of
// the published surface.
// ---------------------------------------------------------------------------

/** One persisted transcript row (role, content, envelope, timestamp). */
export const SessionHistoryMessage = z.object({
  role: z.string(),
  content: z.string(),
  response_data: z.object({
    intent: z.string().nullish(),
    success: z.boolean().nullish(),
  }).nullable().optional(),
  created_at: z.string(),
});
export type SessionHistoryMessage = z.infer<typeof SessionHistoryMessage>;

/** The `GET /v1/conversations/{id}/messages` payload (SESSION-1 #959). */
export const GetSessionHistoryResponse = z.object({
  messages: z.array(SessionHistoryMessage),
  revision: z.number().int().nonnegative(),
  next_offset: z.number().int().nonnegative().nullable(),
});
export type GetSessionHistoryResponse = z.infer<typeof GetSessionHistoryResponse>;

/**
 * Complete Agent path inventory (fastapi_service.py router registrations).
 * `summary` is the inventory entry only — it is not emitted into generated
 * models (spec: future paths appear in the inventory, not as unused models).
 */
export const AGENT_PATHS: AgentPath[] = [
  { method: "GET", path: "/", summary: "service banner" },
  { method: "GET", path: "/healthz", summary: "health and service metadata" },
  { method: "POST", path: "/v1/chat", summary: "chat turn" },
  { method: "POST", path: "/v1/byok/probe", summary: "probe a bring-your-own-key credential" },
  { method: "POST", path: "/v1/feedback", summary: "submit feedback" },
  { method: "GET", path: "/v1/conversations", summary: "list conversations" },
  { method: "PATCH", path: "/v1/conversations/{session_id}", summary: "rename conversation" },
  { method: "GET", path: "/v1/conversations/{session_id}/messages", summary: "conversation messages" },
  { method: "GET", path: "/v1/bangumi/{bangumi_id}/guide", summary: "work guide points" },
  { method: "GET", path: "/v1/bangumi/nearby", summary: "nearby points" },
  { method: "GET", path: "/v1/search/preview", summary: "search preview" },
  { method: "POST", path: "/v1/photo-search", summary: "photo search" },
  { method: "POST", path: "/v1/photo-search/confirm", summary: "confirm photo offer" },
  { method: "POST", path: "/v1/sessions/adopt", summary: "adopt anonymous sessions" },
];
