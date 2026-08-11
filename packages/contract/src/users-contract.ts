/** Self-contained models, errors, and oRPC contract for the Users service. */

import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "./error-registry.js";
import { requireBearer } from "./openapi-security.js";

/** Users error category semantics; categories never cross the wire. */
export const UsersErrorCategory = z.enum(["user_actionable", "retryable", "system"]);
/** Inferred Users error category. */
export type UsersErrorCategory = z.infer<typeof UsersErrorCategory>;

/** Data carried when a saved route does not exist. */
export const SavedRouteNotFoundData = z.object({ saved_route_id: z.string() });
/** Inferred saved-route-not-found data. */
export type SavedRouteNotFoundData = z.infer<typeof SavedRouteNotFoundData>;

/** Data carried when a saved route belongs to another user. */
export const SavedRouteNotOwnedData = z.object({ saved_route_id: z.string() });
/** Inferred saved-route-not-owned data. */
export type SavedRouteNotOwnedData = z.infer<typeof SavedRouteNotOwnedData>;

interface UsersErrorDefItem {
  readonly status: number;
  readonly category: UsersErrorCategory;
  readonly message: string;
  readonly data: z.ZodType;
}

/** Users error registry with registry-only categories kept out of oRPC responses. */
export const USERS_ERROR_DEFS = {
  SAVED_ROUTE_NOT_FOUND: {
    status: 404,
    category: "user_actionable",
    message: "No such saved route",
    data: SavedRouteNotFoundData,
  },
  SAVED_ROUTE_NOT_OWNED: {
    status: 403,
    category: "user_actionable",
    message: "Route belongs to another user",
    data: SavedRouteNotOwnedData,
  },
} as const satisfies Record<string, UsersErrorDefItem>;

/** Users error registry type. */
export type UsersErrorDefs = typeof USERS_ERROR_DEFS;
/** Users error code union. */
export type UsersErrorCode = keyof UsersErrorDefs;

/** Pick oRPC error entries while dropping registry-only category metadata. */
export function pickUsersErrors<const Code extends UsersErrorCode>(
  codes: readonly Code[],
): ReturnType<typeof pickErrors<UsersErrorDefs, Code>> {
  return pickErrors(USERS_ERROR_DEFS, codes);
}

/** Lifecycle status for a user-owned saved route. */
export const SavedRouteStatus = z.enum(["draft", "saved", "completed"]);
/** Inferred saved-route lifecycle status. */
export type SavedRouteStatus = z.infer<typeof SavedRouteStatus>;

/** User-owned saved route returned by the Users service. */
export const SavedRoute = z.object({
  id: z.uuid(),
  title: z.string(),
  point_ids: z.array(z.string()),
  status: SavedRouteStatus,
  saved_at: z.string().nullable(),
  updated_at: z.string(),
});
/** Inferred user-owned saved route. */
export type SavedRoute = z.infer<typeof SavedRoute>;

/** Input for creating or updating a user-owned saved route. */
export const SaveSavedRouteInput = z.object({
  id: z.uuid().optional(),
  title: z.string().min(1).max(200),
  point_ids: z.array(z.string().max(128)).max(500),
  status: SavedRouteStatus.default("saved"),
});
/** Inferred save-saved-route input. */
export type SaveSavedRouteInput = z.infer<typeof SaveSavedRouteInput>;

/** Input for deleting one user-owned saved route. */
export const DeleteSavedRouteInput = z.object({ id: z.uuid() });
/** Inferred delete-saved-route input. */
export type DeleteSavedRouteInput = z.infer<typeof DeleteSavedRouteInput>;

/** Result returned after deleting one user-owned saved route. */
export const DeleteSavedRouteResult = z.object({ deleted: z.literal(true) });
/** Inferred delete-saved-route result. */
export type DeleteSavedRouteResult = z.infer<typeof DeleteSavedRouteResult>;

/** Result returned when listing the caller's saved routes. */
export const ListSavedRoutesResult = z.object({ saved_routes: z.array(SavedRoute) });
/** Inferred list-saved-routes result. */
export type ListSavedRoutesResult = z.infer<typeof ListSavedRoutesResult>;

/** Bounded page controls for listing the caller's sessions. */
export const ListSessionsInput = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  offset: z.coerce.number().int().nonnegative().max(1_000).default(0),
});
/** Inferred session-list page controls. */
export type ListSessionsInput = z.infer<typeof ListSessionsInput>;

/** Conversation summary for one authenticated session. */
export const UserSession = z.strictObject({
  session_id: z.string().min(1),
  title: z.string().nullable(),
  first_query: z.string(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
/** Inferred authenticated session summary. */
export type UserSession = z.infer<typeof UserSession>;

/** One bounded page of the caller's sessions. */
export const ListSessionsResult = z.strictObject({
  sessions: z.array(UserSession).max(50),
  next_offset: z.number().int().nonnegative().nullable(),
});
/** Inferred session-list result. */
export type ListSessionsResult = z.infer<typeof ListSessionsResult>;

/** oRPC contract for authenticated saved-route operations. */
export const usersContract = {
  listSessions: oc
    .route({
      method: "GET",
      path: "/v1/users/sessions",
      summary: "List the caller's sessions",
      spec: requireBearer,
    })
    .input(ListSessionsInput)
    .output(ListSessionsResult),
  listSavedRoutes: oc
    .route({
      method: "GET",
      path: "/v1/users/saved-routes",
      summary: "List the caller's saved routes",
      spec: requireBearer,
    })
    .output(ListSavedRoutesResult),
  saveSavedRoute: oc
    .route({
      method: "POST",
      path: "/v1/users/saved-routes",
      summary: "Create or update a saved route",
      spec: requireBearer,
    })
    .input(SaveSavedRouteInput)
    .errors(pickUsersErrors(["SAVED_ROUTE_NOT_FOUND", "SAVED_ROUTE_NOT_OWNED"]))
    .output(SavedRoute),
  deleteSavedRoute: oc
    .route({
      method: "DELETE",
      path: "/v1/users/saved-routes/{id}",
      summary: "Delete a saved route",
      spec: requireBearer,
    })
    .input(DeleteSavedRouteInput)
    .errors(pickUsersErrors(["SAVED_ROUTE_NOT_FOUND", "SAVED_ROUTE_NOT_OWNED"]))
    .output(DeleteSavedRouteResult),
};

/** Users oRPC contract type. */
export type UsersContract = typeof usersContract;
