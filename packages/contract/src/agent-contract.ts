/**
 * Agent boundary contract — the health/service-metadata wire shapes of the
 * Agent HTTP surface (CONTRACT-1, #938). The path inventory itself is
 * `./agent-paths.ts`, kept out of this file (and deliberately not re-exported
 * from it) because the edge reads it at runtime and this module imports zod
 * (#1285).
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

/** The `POST /v1/byok/probe` success body (D5, #953): one bounded
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
  /**
   * Structured clarify-candidate pick (W1 #1220): sent in place of new free
   * text when the user selects a clarify-card option, so the turn resolves
   * through the deterministic selection channel
   * (`animichi.agents.selection.execute_multi_selection` /
   * `execute_place_selection`, reached via `PublicAPIRequest`'s
   * `CandidateSelectionTurn`/`PointSelectionTurn` dispatch in
   * `application/agent_turn.py`) instead of a model round-trip.
   * `selected_point_ids` selects already-fetched points directly;
   * `selected_candidate_ids` + `clarification_id` select anime/place
   * candidates from the pending clarification and are rejected (409) if
   * `clarification_id` no longer matches the session's current revision.
   */
  selected_point_ids: z.array(z.string()).nullable().optional(),
  selected_candidate_ids: z.array(z.string()).nullable().optional(),
  clarification_id: z.number().int().nullable().optional(),
});
export type ChatTurnRequest = z.infer<typeof ChatTurnRequest>;
