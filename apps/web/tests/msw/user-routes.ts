import { http, HttpResponse } from "msw";
import type { HttpHandler, JsonBodyType } from "msw";
import { ListRoutesResult, type UserRoute } from "@seichijunrei/contract";
import { orpcErrorResponse } from "./contract-handler";
import { TEST_ORIGIN } from "./fixtures";

/**
 * Contract-typed MSW swimlane for `users.listRoutes` (GET). Same discipline as
 * the anime swimlane: every body is `parse()`d with the contract output schema,
 * so a malformed fixture fails the request instead of leaking a wrong shape.
 */
export const USER_ROUTES_URL = `${TEST_ORIGIN}/v1/users/routes`;

/** A saved route with three points (the shell renders skeleton itinerary slots). */
export const SAVED_ROUTE_ID = "11111111-1111-4111-8111-111111111111";
/** A saved route with zero points (renders the empty state). */
export const EMPTY_ROUTE_ID = "22222222-2222-4222-8222-222222222222";
/** A completed route (renders the 完走 hero badge). */
export const COMPLETED_ROUTE_ID = "33333333-3333-4333-8333-333333333333";

const routesFixture: readonly UserRoute[] = [
  {
    id: SAVED_ROUTE_ID,
    title: "Suga Shrine loop",
    point_ids: ["p1", "p2", "p3"],
    status: "saved",
    saved_at: "2026-07-18T00:00:00.000Z",
    updated_at: "2026-07-18T00:00:00.000Z",
  },
  {
    id: EMPTY_ROUTE_ID,
    title: "Blank draft",
    point_ids: [],
    status: "saved",
    saved_at: null,
    updated_at: "2026-07-18T00:00:00.000Z",
  },
  {
    id: COMPLETED_ROUTE_ID,
    title: "Hida Furukawa walk",
    point_ids: ["p4", "p5"],
    status: "completed",
    saved_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z",
  },
];

/** Default handler: the caller's fixture routes. */
export const userRoutesHandler: HttpHandler = http.get(USER_ROUTES_URL, () =>
  HttpResponse.json(ListRoutesResult.parse({ routes: routesFixture }) as JsonBodyType),
);

/** An always-failing handler for loader error-path tests. */
export const userRoutesOutageHandler: HttpHandler = http.get(USER_ROUTES_URL, () =>
  orpcErrorResponse({ code: "INTERNAL_SERVER_ERROR", status: 500, message: "users unavailable" }),
);
