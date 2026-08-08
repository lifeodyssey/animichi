import { ORPCError } from "@orpc/server";

/** Data carried by both saved-route lookup failures. */
export interface SavedRouteErrorData { saved_route_id: string }

/**
 * No-zod Worker mirror of USERS_ERROR_DEFS. Keep status, category, and message
 * in lockstep with packages/contract/src/users-contract.ts.
 */
export const USERS_ERRORS = {
  SAVED_ROUTE_NOT_FOUND: {
    status: 404, category: "user_actionable", message: "No such saved route",
  },
  SAVED_ROUTE_NOT_OWNED: {
    status: 403, category: "user_actionable", message: "Route belongs to another user",
  },
} as const;

/** Construct a defined saved-route-not-found oRPC error. */
export function savedRouteNotFound(
  savedRouteId: string,
): ORPCError<"SAVED_ROUTE_NOT_FOUND", SavedRouteErrorData> {
  const def = USERS_ERRORS.SAVED_ROUTE_NOT_FOUND;
  return new ORPCError("SAVED_ROUTE_NOT_FOUND", {
    defined: true, status: def.status, message: def.message, data: { saved_route_id: savedRouteId },
  });
}

/** Construct a defined saved-route-not-owned oRPC error. */
export function savedRouteNotOwned(
  savedRouteId: string,
): ORPCError<"SAVED_ROUTE_NOT_OWNED", SavedRouteErrorData> {
  const def = USERS_ERRORS.SAVED_ROUTE_NOT_OWNED;
  return new ORPCError("SAVED_ROUTE_NOT_OWNED", {
    defined: true, status: def.status, message: def.message, data: { saved_route_id: savedRouteId },
  });
}
