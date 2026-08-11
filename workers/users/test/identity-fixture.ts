import type { Env } from "../src/index";

/** Users Worker test environment: no auth/JWKS — identity arrives as headers. */
export const TEST_ENV: Env = {
  ENVIRONMENT: "test",
  DATABASE_URL: "postgresql://fake",
};

/**
 * The edge's verified identity as the users worker sees it over the USERS
 * service binding. This is the ONLY channel the service trusts (AUTH-2 #950);
 * a raw bearer is rejected, and the edge strips any caller-supplied identity
 * headers before forwarding its own.
 */
export function identityHeaders(userId: string, extra: Record<string, string> = {}): Record<string, string> {
  return { "x-user-id": userId, "x-user-type": "human", ...extra };
}
