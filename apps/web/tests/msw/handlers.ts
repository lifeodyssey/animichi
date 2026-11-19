import { http, HttpResponse } from "msw";
import { PointsByBangumiIdInput, SearchResult } from "@animichi/contract";
import { catalogPlanItineraryHandler } from "./catalog-itinerary";
import { contractJsonHandler, orpcErrorResponse } from "./contract-handler";
import { CATALOG_POINTS_BY_BANGUMI_ID_URL } from "./fixtures";

/** A catalog.pointsByBangumiId handler that always fails with the upstream error, for typed-error tests. */
export const catalogUpstreamErrorHandler = contractJsonHandler({
  method: "post",
  url: CATALOG_POINTS_BY_BANGUMI_ID_URL,
  input: PointsByBangumiIdInput,
  output: SearchResult,
  resolve: () => ({
    code: "UPSTREAM_UNAVAILABLE",
    status: 502,
    message: "Upstream catalog source unavailable",
    data: { upstream: "anitabi" },
  }),
});

/**
 * Default session-adoption handler (#507). Every login now posts here, so the
 * unit lane needs it to stay hermetic — `{"adopted": 0}` is the endpoint's
 * own typed no-op for a caller with no anonymous history, which is exactly
 * what a test-tab login is.
 */
export const sessionAdoptHandler = http.post(
  "*/v1/sessions/adopt",
  () => HttpResponse.json({ adopted: 0, noop_class: "no_rows" }),
);

/** Existing UI-only fixtures contain no active native operation unless a test supplies its stream. */
const idleNativeStream = http.get("*/v1/conversations/:sessionId/stream", () => new HttpResponse(null, { status: 204 }));

export const handlers = [catalogPlanItineraryHandler, sessionAdoptHandler, idleNativeStream];

export { orpcErrorResponse };
