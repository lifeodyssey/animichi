import type { OpenAPI } from "@orpc/contract";

/** Require an HTTP bearer token for an OpenAPI operation. */
export function requireBearer(operation: OpenAPI.OperationObject): OpenAPI.OperationObject {
  return { ...operation, security: [{ bearerAuth: [] }] };
}

/** Mark an OpenAPI operation as intentionally anonymous. */
export function allowAnonymous(operation: OpenAPI.OperationObject): OpenAPI.OperationObject {
  return { ...operation, security: [] };
}
