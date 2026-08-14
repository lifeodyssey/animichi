/** Self-contained models, errors, and oRPC contract for the Users service. */

import { oc, type OpenAPI } from "@orpc/contract";
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

/** No data on the idempotency rejections; identity is never echoed back. */
export const IdempotencyErrorData = z.object({});
/** Inferred idempotency-rejection data. */
export type IdempotencyErrorData = z.infer<typeof IdempotencyErrorData>;

/** The documented request header enabling retry-safe SavedRoute creation (issue #1011 AC1). */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/** Hard upper bound (bytes) on a supplied Idempotency-Key; enforced
 * server-side so an over-long token is rejected with a typed 400 (issue #1011
 * "abuse-bounded"). The browser's payload-derived key is a 64-bit FNV-1a hex,
 * well under this. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128 as const;
/** Idempotency-key contract rule: a bounded opaque token scoped to the
 * (authenticated owner, operation) server-side, max IDEMPOTENCY_KEY_MAX_LENGTH. */
export const IdempotencyKeyRule = z.object({
  header: z.literal(IDEMPOTENCY_KEY_HEADER),
  scope: z.literal("owner+operation"),
  format: z.literal("opaque"),
  maxLength: z.literal(IDEMPOTENCY_KEY_MAX_LENGTH),
});
/** Inferred idempotency-key contract rule. */
export type IdempotencyKeyRule = z.infer<typeof IdempotencyKeyRule>;

/** The documented Idempotency-Key header as an OpenAPI parameter (AC1). */
export const IDEMPOTENCY_KEY_PARAM: OpenAPI.ParameterObject = {
  name: IDEMPOTENCY_KEY_HEADER,
  in: "header",
  description:
    "Retry-safe SavedRoute creation key, scoped to the authenticated owner + this operation. " +
    "Same key/payload returns the original result; same key/different payload returns 409; " +
    "concurrent retries create exactly one route.",
  schema: { type: "string", maxLength: IDEMPOTENCY_KEY_MAX_LENGTH },
};

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
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    category: "user_actionable",
    message: "Idempotency-Key was already used with a different payload",
    data: IdempotencyErrorData,
  },
  IDEMPOTENCY_IN_FLIGHT: {
    status: 409,
    category: "retryable",
    message: "A save with this Idempotency-Key is still in progress; retry shortly",
    data: IdempotencyErrorData,
  },
  IDEMPOTENCY_KEY_INVALID: {
    status: 400,
    category: "user_actionable",
    message: "The Idempotency-Key is malformed or too long",
    data: IdempotencyErrorData,
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

/** requireBearer plus the documented Idempotency-Key header (AC1). */
function idempotentSaveSpec(operation: OpenAPI.OperationObject): OpenAPI.OperationObject {
  return {
    ...requireBearer(operation),
    parameters: [...(operation.parameters ?? []), IDEMPOTENCY_KEY_PARAM],
  };
}

/** oRPC contract for authenticated saved-route operations. */
export const usersContract = {
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
      description:
        "Creating a saved route (no id) is retry-safe when an " + IDEMPOTENCY_KEY_HEADER +
        " is supplied: the key is scoped to the authenticated owner + this operation, so " +
        "retrying the same key/payload returns the original result, a different payload under " +
        "the same key returns 409, and concurrent retries create exactly one route.",
      spec: idempotentSaveSpec,
    })
    .input(SaveSavedRouteInput)
    .errors(pickUsersErrors([
      "SAVED_ROUTE_NOT_FOUND", "SAVED_ROUTE_NOT_OWNED",
      "IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_IN_FLIGHT", "IDEMPOTENCY_KEY_INVALID",
    ]))
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
