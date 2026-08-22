import type { GitHubOidcClaims } from "@animichi/contract/oidc-github";
import type { PinReader } from "./pin";
import { REPOSITORY } from "./policy";

const PRODUCTION_SUB_ANCHOR = `repo:${REPOSITORY}:environment:production`;

export function isProductionAnchor(claims: GitHubOidcClaims): boolean {
  return claims.environment === "production" || claims.sub === PRODUCTION_SUB_ANCHOR;
}

/** Staging accepts iff the token's sha is a non-empty string equal to the commit. */
export function stagingCommitEligible(claimsSha: string | undefined, commit: string): boolean {
  return claimsSha !== undefined && claimsSha.length > 0 && claimsSha === commit;
}

/** Production accepts iff the manifest pin at the token's sha equals the commit. */
export async function productionCommitEligible(
  claimsSha: string | undefined,
  commit: string,
  readPin: PinReader,
): Promise<boolean> {
  if (claimsSha === undefined || claimsSha.length === 0) return false;
  const pin = await readPin(claimsSha);
  return pin !== null && pin.length > 0 && pin === commit;
}

export function triggerEnvironment(claims: GitHubOidcClaims): string | undefined {
  if (isProductionAnchor(claims)) return "production";
  return claims.environment;
}

export async function commitEligible(
  claims: GitHubOidcClaims,
  commit: string,
  readPin: PinReader,
): Promise<boolean> {
  if (claims.environment === "staging") return stagingCommitEligible(claims.sha, commit);
  if (isProductionAnchor(claims)) return productionCommitEligible(claims.sha, commit, readPin);
  return false;
}
