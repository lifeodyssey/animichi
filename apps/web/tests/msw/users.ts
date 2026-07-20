import { http, HttpResponse } from "msw";
import type { HttpHandler, JsonBodyType } from "msw";
import { ListRoutesResult } from "@seichijunrei/contract";
import type { UserRoute } from "@seichijunrei/contract";
import { orpcErrorResponse } from "./contract-handler";
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
