/**
 * Compile-time pairing lock for the `data-response` projection (#1283).
 *
 * Included by tsconfig, excluded from `node --test "test/*.test.ts"` — the same
 * arrangement `workers/catalog/test/router-shape-lock.type-test.ts` uses, and
 * for the same reason: what is under test is whether the code COMPILES, so the
 * assertion is the typecheck lane, not a runtime one.
 *
 * `chatResponsePart` returns `packages/contract`'s own `ChatResponseDataPart`
 * union rather than a local restatement of it. The value of that is exactly
 * what is pinned below: an intent may only travel with the `data` its own union
 * member declares. Each `@ts-expect-error` fails the lane if the directive
 * becomes unnecessary — that is, the moment a wrong pairing starts compiling.
 */
import type { ChatResponseDataPart } from "@animichi/contract";

const CLARIFICATION = { reason: "anime_ambiguity", candidates: [{ id: "1", title: "らき☆すた" }] };
const ENVELOPE = { success: true, status: "ok", message: "…" };

/** The pairing the projection actually emits for a clarify answer. */
export const CLARIFY_PART: ChatResponseDataPart = {
  intent: "clarify",
  ...ENVELOPE,
  data: CLARIFICATION,
};

// Each wrong pairing is ONE physical line, because `@ts-expect-error` covers the
// next line only and a multi-line literal lets the error land on whichever line
// the checker prefers — which would make the directive itself the flaky part.

// @ts-expect-error -- `plan_route` carries RouteData, never a clarification; removing this directive must fail tsc.
export const ROUTE_WITH_CLARIFICATION: ChatResponseDataPart = { intent: "plan_route", ...ENVELOPE, data: CLARIFICATION };

// @ts-expect-error -- `clarify` carries ClarificationData, never search rows; removing this directive must fail tsc.
export const CLARIFY_WITH_RESULTS: ChatResponseDataPart = { intent: "clarify", ...ENVELOPE, data: { results: { row_count: 2 } } };

// @ts-expect-error -- `greet_user` carries EmptyData, never an itinerary; removing this directive must fail tsc.
export const GREETING_WITH_ITINERARY: ChatResponseDataPart = { intent: "greet_user", ...ENVELOPE, data: { itinerary: { point_count: 2 } } };

/** The two selection pairings #1288 added, in the shapes the projection emits. */
export const SELECTED_PART: ChatResponseDataPart = {
  intent: "plan_selected",
  ...ENVELOPE,
  data: { itinerary: { point_count: 2 } },
};

export const MULTI_PART: ChatResponseDataPart = {
  intent: "plan_multi",
  ...ENVELOPE,
  data: { results: { row_count: 3, kind: "multi" }, itinerary: { point_count: 3 } },
};

// @ts-expect-error -- `plan_multi` carries RouteData, never a clarification; removing this directive must fail tsc.
export const MULTI_WITH_CLARIFICATION: ChatResponseDataPart = { intent: "plan_multi", ...ENVELOPE, data: CLARIFICATION };

// @ts-expect-error -- `search_nearby` carries SearchData, never an itinerary; removing this directive must fail tsc.
export const PLACE_WITH_ITINERARY: ChatResponseDataPart = { intent: "search_nearby", ...ENVELOPE, data: { itinerary: {} } };
