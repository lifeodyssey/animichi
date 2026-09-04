/**
 * Parameter schemas for the tools the agent exposes to the model: the four
 * catalog tools, the two web tools (#1287), and the `respond` tool one turn
 * ends on (#1283).
 *
 * They live HERE, in zod, because three of the four catalog ones carry constraints the
 * catalog already declares for its own request bodies (`ResolveInput.query`,
 * `PointsByBangumiIdInput.bangumi_id`, `NearbyInput.radius_m`, `Pacing`).
 * Re-declaring those in typebox next to the tools would be the second copy
 * spec §二 forbids, so the tools compose the contract's own schemas and one
 * emitter (`scripts/emit-tool-schemas.ts`) converts them to JSON Schema. The web
 * tools compose nothing — they are declared here anyway, because a second
 * zod↔JSON-Schema conversion is the thing that seam exists to prevent.
 *
 * Nothing here is a wire type: no oRPC procedure and no OpenAPI document
 * references it. It is the LLM-facing surface of `workers/edge`'s agent tier,
 * kept in this package for the single reason that this is where zod runs.
 */

import { z } from "zod";
import { NearbyInput, PointsByBangumiIdInput, ResolveInput } from "./contract.js";
import { Pacing } from "./models.js";

/**
 * At least one character that is not whitespace.
 *
 * `ResolveInput.query` is `.trim().min(1)`, and trimming is a transform JSON
 * Schema has no way to carry: emitted alone it becomes `minLength: 1`, which a
 * model satisfies with a run of spaces the catalog would then reject. The
 * model-facing schema therefore states the same intent as a pattern, and
 * `workers/edge`'s `resolve_anime` trims before it calls the catalog.
 */
const NON_BLANK = /\S/;

/** `resolve_anime(title)` — free text in, a deterministic anime identity out. */
export const ResolveAnimeParameters = z
  .object({
    title: ResolveInput.shape.query
      .regex(NON_BLANK)
      .describe("The anime title to resolve, as the user wrote it"),
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

/** `web_search(query)` — the public web, for QA and title enrichment only. */
export const WebSearchParameters = z
  .object({
    query: z
      .string()
      .regex(NON_BLANK)
      .describe(
        'The search query. Be specific, and include the language you want results in \u2014 for example "\u97ff\u3051\uff01\u30e6\u30fc\u30d5\u30a9\u30cb\u30a2\u30e0 Chinese name \u4e2d\u6587\u540d" or "\u846c\u9001\u306e\u30d5\u30ea\u30fc\u30ec\u30f3 English title Wikipedia"',
      ),
  })
  .strict();
export type WebSearchParameters = z.infer<typeof WebSearchParameters>;

/**
 * The three locales the agent translates between.
 *
 * Python spelled the same vocabulary twice — once in the tool docstring the
 * model read and once in `translation._locale_name`'s lookup, which quietly
 * fell back to echoing an unknown code. Declaring it here makes the schema
 * refuse a fourth code before the model's call ever reaches the tool.
 */
export const TRANSLATION_LOCALES = ["ja", "zh", "en"] as const;

/** One locale the agent can translate a title into. */
export type TranslationLocale = (typeof TRANSLATION_LOCALES)[number];

/** `translate_anime_title(title, target_language)` — catalog or model localization. */
export const TranslateAnimeTitleParameters = z
  .object({
    title: z
      .string()
      .regex(NON_BLANK)
      .describe(
        'The anime title to translate; it may be in any language, for example "\u541b\u306e\u540d\u306f\u3002", "Your Name" or "\u4f60\u7684\u540d\u5b57"',
      ),
    target_language: z
      .enum(TRANSLATION_LOCALES)
      .describe("The language code to translate the title into"),
  })
  .strict();
export type TranslateAnimeTitleParameters = z.infer<typeof TranslateAnimeTitleParameters>;

/** Every catalog tool's parameters, keyed by the name the model calls. */
export const CATALOG_TOOL_PARAMETERS = {
  resolve_anime: ResolveAnimeParameters,
  search_bangumi: SearchBangumiParameters,
  search_nearby: SearchNearbyParameters,
  plan_route: PlanRouteParameters,
} as const;

/** The name of one catalog tool. */
export type CatalogToolName = keyof typeof CATALOG_TOOL_PARAMETERS;

/**
 * The two tools that leave the catalog: the public web, and localization.
 *
 * A table of their own rather than more entries in `CATALOG_TOOL_PARAMETERS`,
 * because the two sets differ in the one way that matters here: a catalog tool
 * composes the catalog's own request constraints, and these two compose
 * nothing — their parameters are the model-facing surface and there is no
 * second declaration for them to agree with.
 */
export const WEB_TOOL_PARAMETERS = {
  web_search: WebSearchParameters,
  translate_anime_title: TranslateAnimeTitleParameters,
} as const;

/** The name of one web tool. */
export type WebToolName = keyof typeof WEB_TOOL_PARAMETERS;

/** The tool a turn ends on: the model submits its answer by calling it (#1283). */
export const ANSWER_TOOL_NAME = "respond";

/**
 * What the model says its answer IS — Python's output vocabulary
 * (`runtime_models.RuntimeStageOutput`), one member per response model the
 * agent could return: `SearchResponseModel`, `ItineraryResponseModel`,
 * `ClarifyResponseModel`, `GreetingResponseModel`, `QAResponseModel`.
 *
 * It is deliberately COARSER than `ChatResponseDataPart`'s `intent`. Python
 * derived `search_bangumi` vs `search_nearby` and `plan_route` vs
 * `plan_selected` from its own recorded steps rather than from the model
 * (`animichi_runner.runtime_stage`), so the model never gets to name a search it
 * did not run; `workers/edge` keeps that split, resolving a kind against the
 * turn's own stored results.
 */
export const ANSWER_KINDS = ["search", "route", "clarify", "greeting", "qa"] as const;

/** One member of the model's answer vocabulary. */
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/**
 * `respond(kind, message, reason?)` — the final answer, as a tool call.
 *
 * The model authors PROSE and a kind, never the envelope: `data`, `status`,
 * `ui` and the candidate list are projected from server state, exactly as
 * `_CompactOutput` ("Forbid the retired model-authored intent, data, and UI
 * envelopes") kept them out of Python's output models.
 */
export const AnswerParameters = z
  .object({
    kind: z
      .enum(ANSWER_KINDS)
      .describe(
        "What this answer is: search (results were found), route (an itinerary was planned), clarify (the user must choose), greeting, or qa",
      ),
    message: z
      .string()
      .regex(NON_BLANK)
      .describe(
        "The reply shown to the user. Brief for search, route and clarify because the app renders the rich UI; a full answer for qa",
      ),
    reason: z
      .string()
      .regex(NON_BLANK)
      .optional()
      .describe(
        "For kind=clarify only: the pending tool outcome's own reason, copied exactly",
      ),
  })
  .strict();
export type AnswerParameters = z.infer<typeof AnswerParameters>;
