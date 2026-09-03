/**
 * Parameter schemas for the four catalog tools the agent exposes to the model.
 *
 * They live HERE, in zod, because three of the four carry constraints the
 * catalog already declares for its own request bodies (`ResolveInput.query`,
 * `PointsByBangumiIdInput.bangumi_id`, `NearbyInput.radius_m`, `Pacing`).
 * Re-declaring those in typebox next to the tools would be the second copy
 * spec §二 forbids, so the tools compose the contract's own schemas and one
 * emitter (`scripts/emit-tool-schemas.ts`) converts them to JSON Schema.
 *
 * Nothing here is a wire type: no oRPC procedure and no OpenAPI document
 * references it. It is the LLM-facing surface of `workers/edge`'s agent tier,
 * kept in this package for the single reason that this is where zod runs.
 */

import { z } from "zod";
import { NearbyInput, PointsByBangumiIdInput, ResolveInput } from "./contract.js";
import { Pacing } from "./models.js";

/** `resolve_anime(title)` — free text in, a deterministic anime identity out. */
export const ResolveAnimeParameters = z
  .object({
    title: ResolveInput.shape.query.describe("The anime title to resolve, as the user wrote it"),
  })
  .strict();
export type ResolveAnimeParameters = z.infer<typeof ResolveAnimeParameters>;

/** `search_bangumi(bangumi_id)` — points for an already-resolved work. */
export const SearchBangumiParameters = z
  .object({
    bangumi_id: PointsByBangumiIdInput.shape.bangumi_id.describe(
      "The bangumi id a previous resolve_anime call returned",
    ),
  })
  .strict();
export type SearchBangumiParameters = z.infer<typeof SearchBangumiParameters>;

/** `search_nearby(location?, radius_m?)` — points around a place or the GPS origin. */
export const SearchNearbyParameters = z
  .object({
    location: z
      .string()
      .min(1)
      .optional()
      .describe("A place name; omit it to search around the user's own coordinates"),
    radius_m: NearbyInput.shape.radius_m
      .int()
      .optional()
      .describe("Search radius in metres; omit it to use the place's own radius"),
  })
  .strict();
export type SearchNearbyParameters = z.infer<typeof SearchNearbyParameters>;

/** `plan_route(search_result_ref, pacing?)` — a route over one stored result. */
export const PlanRouteParameters = z
  .object({
    search_result_ref: z
      .string()
      .min(1)
      .describe("The result_ref a previous search_bangumi or search_nearby outcome returned"),
    pacing: Pacing.optional().describe("How densely to pack the day"),
  })
  .strict();
export type PlanRouteParameters = z.infer<typeof PlanRouteParameters>;

/** Every catalog tool's parameters, keyed by the name the model calls. */
export const CATALOG_TOOL_PARAMETERS = {
  resolve_anime: ResolveAnimeParameters,
  search_bangumi: SearchBangumiParameters,
  search_nearby: SearchNearbyParameters,
  plan_route: PlanRouteParameters,
} as const;

/** The name of one catalog tool. */
export type CatalogToolName = keyof typeof CATALOG_TOOL_PARAMETERS;
