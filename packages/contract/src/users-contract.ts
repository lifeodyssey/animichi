/** Self-contained models, errors, and oRPC contract for the Users service. */

import { oc } from "@orpc/contract";
import { z } from "zod";

/** Users error category semantics; categories never cross the wire. */
export const UsersErrorCategory = z.enum(["user_actionable", "retryable", "system"]);
/** Inferred Users error category. */
export type UsersErrorCategory = z.infer<typeof UsersErrorCategory>;

/** Data carried when a saved route does not exist. */
export const RouteNotFoundData = z.object({ route_id: z.string() });
/** Inferred route-not-found data. */
export type RouteNotFoundData = z.infer<typeof RouteNotFoundData>;

/** Data carried when a saved route belongs to another user. */
export const RouteNotOwnedData = z.object({ route_id: z.string() });
/** Inferred route-not-owned data. */
export type RouteNotOwnedData = z.infer<typeof RouteNotOwnedData>;

type UsersErrorDefItem = {
  readonly status: number;
  readonly category: UsersErrorCategory;
  readonly message: string;
  readonly data: z.ZodType<unknown>;
};

/** Users error registry with registry-only categories kept out of oRPC responses. */
export const USERS_ERROR_DEFS = {
  ROUTE_NOT_FOUND: {
    status: 404,
    category: "user_actionable",
    message: "No such saved route",
    data: RouteNotFoundData,
  },
  ROUTE_NOT_OWNED: {
    status: 403,
    category: "user_actionable",
    message: "Route belongs to another user",
    data: RouteNotOwnedData,
  },
} as const satisfies Record<string, UsersErrorDefItem>;

/** Users error registry type. */
export type UsersErrorDefs = typeof USERS_ERROR_DEFS;
/** Users error code union. */
export type UsersErrorCode = keyof UsersErrorDefs;

type UsersErrorMapItem<Code extends UsersErrorCode> = {
  status: UsersErrorDefs[Code]["status"];
  message: UsersErrorDefs[Code]["message"];
  data: UsersErrorDefs[Code]["data"];
};
type UsersErrorMap<Code extends UsersErrorCode> = {
  [Key in Code]: UsersErrorMapItem<Key>;
};

function usersErrorEntry<Code extends UsersErrorCode>(
  code: Code,
): readonly [Code, UsersErrorMapItem<Code>] {
  const { status, message, data } = USERS_ERROR_DEFS[code];
  return [code, { status, message, data }];
}

/** Pick oRPC error entries while dropping registry-only category metadata. */
export function pickUsersErrors<const Code extends UsersErrorCode>(
  codes: readonly Code[],
): UsersErrorMap<Code> {
  return Object.fromEntries(codes.map(usersErrorEntry)) as UsersErrorMap<Code>;
}

/** Lifecycle status for a user-owned route. */
export const RouteStatus = z.enum(["draft", "saved", "completed"]);
/** Inferred route lifecycle status. */
export type RouteStatus = z.infer<typeof RouteStatus>;

/** User-owned route returned by the Users service. */
export const UserRoute = z.object({
  id: z.uuid(),
  title: z.string(),
  point_ids: z.array(z.string()),
  status: RouteStatus,
  saved_at: z.string().nullable(),
  updated_at: z.string(),
});
/** Inferred user-owned route. */
export type UserRoute = z.infer<typeof UserRoute>;

/** Input for creating or updating a user-owned route. */
export const SaveRouteInput = z.object({
  id: z.uuid().optional(),
  title: z.string().min(1).max(200),
  point_ids: z.array(z.string()).max(500),
  status: RouteStatus.default("saved"),
});
/** Inferred save-route input. */
export type SaveRouteInput = z.infer<typeof SaveRouteInput>;

/** Result returned when listing the caller's routes. */
export const ListRoutesResult = z.object({ routes: z.array(UserRoute) });
/** Inferred list-routes result. */
export type ListRoutesResult = z.infer<typeof ListRoutesResult>;

/** oRPC contract for authenticated user-route operations. */
export const usersContract = {
  listRoutes: oc
    .route({ method: "GET", path: "/v1/users/routes", summary: "List the caller's saved routes" })
    .output(ListRoutesResult),
  saveRoute: oc
    .route({ method: "POST", path: "/v1/users/routes", summary: "Create or update a saved route" })
    .input(SaveRouteInput)
    .errors(pickUsersErrors(["ROUTE_NOT_FOUND", "ROUTE_NOT_OWNED"]))
    .output(UserRoute),
};

/** Users oRPC contract type. */
export type UsersContract = typeof usersContract;
