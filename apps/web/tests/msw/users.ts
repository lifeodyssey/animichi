import { http, HttpResponse } from "msw";
import type { HttpHandler, JsonBodyType } from "msw";
import { ListRoutesResult, SaveRouteInput, UserRoute as UserRouteSchema } from "@seichijunrei/contract";
import type { UserRoute } from "@seichijunrei/contract";
import { contractJsonHandler, orpcErrorResponse } from "./contract-handler";
import { TEST_ORIGIN } from "./fixtures";

/**
 * Contract-typed MSW swimlane for the authenticated `users.listRoutes` GET
 * route. The body is `parse()`d with the contract's `ListRoutesResult` — no
 * hand-written JSON — and the 401 handler models a logged-out caller.
 */
export const USERS_ROUTES_URL = `${TEST_ORIGIN}/v1/users/routes`;

export const draftRoute: UserRoute = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Uji × Euphonium",
  point_ids: ["p1", "p2"],
  status: "draft",
  saved_at: null,
  updated_at: "2026-07-15T00:00:00.000Z",
};

function routesResponse(routes: readonly UserRoute[]): HttpResponse<JsonBodyType> {
  return HttpResponse.json(ListRoutesResult.parse({ routes }) as JsonBodyType);
}

export const usersRoutesWithDraftHandler: HttpHandler = http.get(USERS_ROUTES_URL, () =>
  routesResponse([draftRoute]),
);

export const usersRoutesEmptyHandler: HttpHandler = http.get(USERS_ROUTES_URL, () =>
  routesResponse([]),
);

export const usersRoutesUnauthorizedHandler: HttpHandler = http.get(USERS_ROUTES_URL, () =>
  orpcErrorResponse({ code: "UNAUTHORIZED", status: 401, message: "Sign in required" }),
);

/** Saved ids: create-on-login always creates, so a fresh id per call is right. */
const SAVED_ID = "44444444-4444-4444-8444-444444444444";

/** Create-on-login swimlane: `users.saveRoute` echoes the persisted row back. */
export const usersSaveRouteHandler: HttpHandler = contractJsonHandler({
  method: "post",
  url: USERS_ROUTES_URL,
  input: SaveRouteInput,
  output: UserRouteSchema,
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
export const usersSaveRouteOutageHandler: HttpHandler = http.post(USERS_ROUTES_URL, () =>
  orpcErrorResponse({ code: "INTERNAL_SERVER_ERROR", status: 500, message: "users unavailable" }),
);
