import { ORPCError } from "@orpc/server";

/** Data carried by both saved-route lookup failures. */
export interface SavedRouteErrorData { saved_route_id: string }

/** No data on the idempotency rejections; identity is not echoed back. */
export type IdempotencyErrorData = Record<string, never>;

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
  IDEMPOTENCY_CONFLICT: {
    status: 409, category: "user_actionable",
    message: "Idempotency-Key was already used with a different payload",
  },
  IDEMPOTENCY_IN_FLIGHT: {
    status: 409, category: "retryable",
    message: "A save with this Idempotency-Key is still in progress; retry shortly",
  },
  IDEMPOTENCY_KEY_INVALID: {
    status: 400, category: "user_actionable",
    message: "The Idempotency-Key is malformed or too long",
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

/** Construct a typed 409: the key was already consumed by a different payload. */
export function savedRouteIdempotencyConflict(): ORPCError<"IDEMPOTENCY_CONFLICT", IdempotencyErrorData> {
  const def = USERS_ERRORS.IDEMPOTENCY_CONFLICT;
  return new ORPCError("IDEMPOTENCY_CONFLICT", {
    defined: true, status: def.status, message: def.message, data: {},
  });
}

/** Construct a typed retryable 409: a save with this key is still in flight. */
export function savedRouteIdempotencyInFlight(): ORPCError<"IDEMPOTENCY_IN_FLIGHT", IdempotencyErrorData> {
  const def = USERS_ERRORS.IDEMPOTENCY_IN_FLIGHT;
  return new ORPCError("IDEMPOTENCY_IN_FLIGHT", {
    defined: true, status: def.status, message: def.message, data: {},
  });
}
