/** The three runtime-role passwords the fixtures stand in for (#1915).
 *
 * A separate, dependency-free module: `test/apply-lock-entry.ts` bundles it into a real
 * workerd runtime, so it must not drag the HTTP-seam helpers' imports along.
 */
export const SERVICE_ROLE_PASSWORDS = {
  catalogSvc: "catalog-svc-fixture-password",
  usersSvc: "users-svc-fixture-password",
  agentSvc: "agent-svc-fixture-password",
} as const;
