import { USERS_ERROR_DEFS, type UsersErrorCode } from "@animichi/contract";
import { ORPCError } from "@orpc/server";

/** Data carried by both saved-route lookup failures. */
export interface SavedRouteErrorData { saved_route_id: string }

/** No data on the idempotency rejections; identity is not echoed back. */
export type IdempotencyErrorData = Record<string, never>;

/**
 * A defined oRPC error for `code`, with the status and message the contract's
 * USERS_ERROR_DEFS registry gives it. The registry is read rather than mirrored:
 * the Worker already ships the contract module that holds it (`router.ts`
 * implements `usersContract` from the same module), so a hand-kept copy here
 * could only drift. The category stays in the registry; it never crosses the wire.
 */
function definedError<Code extends UsersErrorCode, Data>(code: Code, data: Data): ORPCError<Code, Data> {
  const { status, message } = USERS_ERROR_DEFS[code];
  return new ORPCError(code, { defined: true, status, message, data });
}

/** Construct a defined saved-route-not-found oRPC error. */
export function savedRouteNotFound(
  savedRouteId: string,
): ORPCError<"SAVED_ROUTE_NOT_FOUND", SavedRouteErrorData> {
  return definedError("SAVED_ROUTE_NOT_FOUND", { saved_route_id: savedRouteId });
}

/** Construct a defined saved-route-not-owned oRPC error. */
export function savedRouteNotOwned(
  savedRouteId: string,
): ORPCError<"SAVED_ROUTE_NOT_OWNED", SavedRouteErrorData> {
  return definedError("SAVED_ROUTE_NOT_OWNED", { saved_route_id: savedRouteId });
}

/** Construct a typed 409: the key was already consumed by a different payload. */
export function savedRouteIdempotencyConflict(): ORPCError<"IDEMPOTENCY_CONFLICT", IdempotencyErrorData> {
  return definedError("IDEMPOTENCY_CONFLICT", {});
}

/** Construct a typed retryable 409: a save with this key is still in flight. */
export function savedRouteIdempotencyInFlight(): ORPCError<"IDEMPOTENCY_IN_FLIGHT", IdempotencyErrorData> {
  return definedError("IDEMPOTENCY_IN_FLIGHT", {});
}
