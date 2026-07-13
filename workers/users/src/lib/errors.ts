import { ORPCError } from "@orpc/server";

/** Data carried by both user-route lookup failures. */
export interface RouteErrorData { route_id: string }

/**
 * No-zod Worker mirror of USERS_ERROR_DEFS. Keep status, category, and message
 * in lockstep with packages/contract/src/users-contract.ts.
 */
export const USERS_ERRORS = {
  ROUTE_NOT_FOUND: {
    status: 404, category: "user_actionable", message: "No such saved route",
  },
  ROUTE_NOT_OWNED: {
    status: 403, category: "user_actionable", message: "Route belongs to another user",
  },
} as const;

/** Construct a defined route-not-found oRPC error. */
export function routeNotFound(
  routeId: string,
): ORPCError<"ROUTE_NOT_FOUND", RouteErrorData> {
  const def = USERS_ERRORS.ROUTE_NOT_FOUND;
  return new ORPCError("ROUTE_NOT_FOUND", {
    defined: true, status: def.status, message: def.message, data: { route_id: routeId },
  });
}

/** Construct a defined route-not-owned oRPC error. */
export function routeNotOwned(
  routeId: string,
): ORPCError<"ROUTE_NOT_OWNED", RouteErrorData> {
  const def = USERS_ERRORS.ROUTE_NOT_OWNED;
  return new ORPCError("ROUTE_NOT_OWNED", {
    defined: true, status: def.status, message: def.message, data: { route_id: routeId },
  });
}
