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

/** One published Agent path in the complete inventory. */
export interface AgentPath {
  method: "GET" | "POST" | "PATCH";
  path: string;
  summary: string;
}

/**
 * Complete Agent path inventory (fastapi_service.py router registrations).
 * `summary` is the inventory entry only — it is not emitted into generated
 * models (spec: future paths appear in the inventory, not as unused models).
 */
export const AGENT_PATHS: AgentPath[] = [
  { method: "GET", path: "/", summary: "service banner" },
  { method: "GET", path: "/healthz", summary: "health and service metadata" },
  { method: "POST", path: "/v1/runtime", summary: "runtime request" },
  { method: "POST", path: "/v1/runtime/stream", summary: "streaming runtime request" },
  { method: "POST", path: "/v1/chat", summary: "chat turn" },
  { method: "POST", path: "/v1/byok/probe", summary: "probe a bring-your-own-key credential" },
  { method: "POST", path: "/v1/feedback", summary: "submit feedback" },
  { method: "GET", path: "/v1/conversations", summary: "list conversations" },
  { method: "PATCH", path: "/v1/conversations/{session_id}", summary: "rename conversation" },
  { method: "GET", path: "/v1/conversations/{session_id}/messages", summary: "conversation messages" },
  { method: "GET", path: "/v1/bangumi/popular", summary: "popular works" },
  { method: "GET", path: "/v1/bangumi/{bangumi_id}/guide", summary: "work guide points" },
  { method: "GET", path: "/v1/bangumi/nearby", summary: "nearby points" },
  { method: "GET", path: "/v1/search/preview", summary: "search preview" },
  { method: "POST", path: "/v1/photo-search", summary: "photo search" },
  { method: "POST", path: "/v1/photo-search/confirm", summary: "confirm photo offer" },
  { method: "POST", path: "/v1/session/migrate", summary: "migrate anonymous session" },
];
