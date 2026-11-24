/**
 * How the catalog's oRPC handler answers a procedure that threw something other than an
 * `ORPCError`, such as a failed query or a failed connect. `toORPCError` (`@orpc/client`) makes it
 * INTERNAL_SERVER_ERROR with the message "Internal server error" and keeps what was thrown only as
 * its `cause`, which the OpenAPI codec does not serialize, so neither the database URL nor the
 * driver's message reaches the body. Before Prisma rc.14 a database the catalog could not reach
 * failed the first query inside a procedure and was answered this way.
 */
export const FAILED_PROCEDURE = {
  status: 500,
  body: '{"defined":false,"code":"INTERNAL_SERVER_ERROR","status":500,"message":"Internal server error"}',
};
