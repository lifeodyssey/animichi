/**
 * Internal service-binding protocol (issue #1005 AC6).
 *
 * The edge↔users binding is the internal trust boundary: the edge verifies a
 * Neon Auth bearer, strips it, and forwards only the verified identity as
 * headers over the `USERS` service binding. Those header names and the path
 * prefix are a shared, versioned contract — both the current (N) and the
 * previously deployed (N-1) Users worker must speak exactly these strings, or
 * a rolling promotion silently drops identity. Centralizing them here lets
 * the N/N-1 fixture (packages/contract/test/rolling-compat.test.ts) assert
 * the protocol is version-invariant instead of hand-remembered.
 */

/** The edge's verified user id, forwarded to the Users worker. */
export const USER_IDENTITY_HEADER = "X-User-Id";

/** The edge's verified identity class (`human` | `anonymous`), forwarded too. */
export const USER_TYPE_HEADER = "X-User-Type";

/** The caller-supplied credential the edge strips before forwarding. */
export const AUTHORIZATION_HEADER = "Authorization";

/** The gateway's ID for one request, sent to every service binding it forwards
 * to and returned to the caller under the same name. The gateway mints it and
 * overwrites any value a caller sent under this name, so a service reached only
 * through a binding may log it as the gateway's. */
export const REQUEST_ID_HEADER = "X-Request-Id";

/** The one format the gateway mints request IDs in (`crypto.randomUUID()`): a
 * lowercase UUID, 36 characters. */
const REQUEST_ID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The request ID a service may write to its logs for a `REQUEST_ID_HEADER`
 * value: the value itself in the gateway's format, otherwise nothing, so a
 * malformed or oversized header never becomes log text. */
export function acceptedRequestId(value: string | undefined): string | undefined {
  return value !== undefined && REQUEST_ID_FORMAT.test(value) ? value : undefined;
}

/** The only reachable Users surface: everything under this prefix. */
export const USERS_BINDING_PREFIX = "/v1/users/";
