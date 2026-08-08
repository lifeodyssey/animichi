import { http, HttpResponse } from "msw";
import type { HttpHandler, JsonBodyType } from "msw";
import { ListSavedRoutesResult, SaveSavedRouteInput, SavedRoute as SavedRouteSchema } from "@animichi/contract";
import type { SavedRoute } from "@animichi/contract";
import { contractJsonHandler, orpcErrorResponse } from "./contract-handler";
import { TEST_ORIGIN } from "./fixtures";

/**
 * Contract-typed MSW swimlane for the authenticated saved-route endpoints:
 * `users.listSavedRoutes` (GET) and `users.saveSavedRoute` (POST). Every body
 * is `parse()`d with the contract schema — no hand-written JSON — and the 401
 * handler models a logged-out caller.
 */
export const USERS_SAVED_ROUTES_URL = `${TEST_ORIGIN}/v1/users/saved-routes`;

export const draftRoute: SavedRoute = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Uji × Euphonium",
  point_ids: ["p1", "p2"],
  status: "draft",
  saved_at: null,
  updated_at: "2026-07-15T00:00:00.000Z",
};

function savedRoutesResponse(savedRoutes: readonly SavedRoute[]): HttpResponse<JsonBodyType> {
  return HttpResponse.json(ListSavedRoutesResult.parse({ saved_routes: savedRoutes }) as JsonBodyType);
}

export const usersSavedRoutesWithDraftHandler: HttpHandler = http.get(USERS_SAVED_ROUTES_URL, () =>
  savedRoutesResponse([draftRoute]),
);

export const usersSavedRoutesEmptyHandler: HttpHandler = http.get(USERS_SAVED_ROUTES_URL, () =>
  savedRoutesResponse([]),
);

export const usersSavedRoutesUnauthorizedHandler: HttpHandler = http.get(USERS_SAVED_ROUTES_URL, () =>
  orpcErrorResponse({ code: "UNAUTHORIZED", status: 401, message: "Sign in required" }),
);

/** A fixed id is enough for unit assertions; the stateful create-on-login
 * integration swimlane (tests/integration/create-on-login.test.ts) is the one
 * that mints a distinct id per save. */
const SAVED_ID = "44444444-4444-4444-8444-444444444444";

/** `users.saveSavedRoute` echoes the persisted row back. */
export const usersSaveSavedRouteHandler: HttpHandler = contractJsonHandler({
  method: "post",
  url: USERS_SAVED_ROUTES_URL,
  input: SaveSavedRouteInput,
  output: SavedRouteSchema,
  resolve: (input) => ({
    id: input.id ?? SAVED_ID,
    title: input.title,
    point_ids: input.point_ids,
    status: input.status,
    saved_at: "2026-07-28T00:00:00.000Z",
    updated_at: "2026-07-28T00:00:00.000Z",
  }),
});

/** A users service that is down; the card must retry in place, not blow up. */
export const usersSaveSavedRouteOutageHandler: HttpHandler = http.post(USERS_SAVED_ROUTES_URL, () =>
  orpcErrorResponse({ code: "INTERNAL_SERVER_ERROR", status: 500, message: "users unavailable" }),
);
