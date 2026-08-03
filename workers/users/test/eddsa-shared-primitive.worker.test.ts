import contractJwtSource from "../../../packages/contract/src/jwt.ts?raw";
import edgeAuthSource from "../../../worker/auth.ts?raw";
import { describe, expect, it } from "vitest";
import usersJwtSource from "../src/auth/jwt.ts?raw";

/**
 * Neon Auth EdDSA verification lived twice — `worker/auth.ts` (edge `/v1`) and
 * `workers/users/src/auth/jwt.ts` (this service's own JWKS check) each called
 * `jose.jwtVerify` with a hand-typed `algorithms: ["EdDSA"]` restriction. Two
 * engineers keeping the same cryptographic policy in sync by memory is exactly
 * the failure mode iter6 B9 (issue #647) exists to close: both now delegate to
 * `verifyEdDsaJwt` in `@animichi/contract/jwt` (fix(auth): share edge security
 * primitives, 1edb45a5). This guard fails the moment either consumer drifts
 * back to its own inline `algorithms: ["EdDSA"]`, since a re-inlined check is
 * a policy fork nothing else here would notice.
 */
export const READS = [
  "packages/contract/src/jwt.ts",
  "worker/auth.ts",
  "workers/users/src/auth/jwt.ts",
] as const;

const IMPORTS_SHARED_VERIFIER =
  /import\s*\{[^}]*\bverifyEdDsaJwt\b[^}]*\}\s*from\s*["']@animichi\/contract\/jwt["']/;

describe("EdDSA verification stays a single shared primitive (issue #647)", () => {
  it("the edge worker (/v1) delegates to the shared verifier", () => {
    expect(edgeAuthSource).toMatch(IMPORTS_SHARED_VERIFIER);
  });

  it("the users worker delegates to the shared verifier", () => {
    expect(usersJwtSource).toMatch(IMPORTS_SHARED_VERIFIER);
  });

  it("neither consumer hand-rolls its own EdDSA algorithm restriction", () => {
    // `worker/auth.ts` legitimately reads a JWT header's `alg` field to decide
    // *whether* to route to the Neon verifier — that is routing logic, not a
    // second implementation of the crypto policy. What must never reappear in
    // either consumer is an inline `jwtVerify(..., { algorithms: ["EdDSA"] })`
    // — that is the literal duplication `verifyEdDsaJwt` replaced.
    const inlineAlgorithmRestriction = /algorithms:\s*\[\s*["']EdDSA["']\s*\]/;
    expect(edgeAuthSource).not.toMatch(inlineAlgorithmRestriction);
    expect(usersJwtSource).not.toMatch(inlineAlgorithmRestriction);
  });

  it("the shared primitive is still the one place EdDSA is pinned", () => {
    expect(contractJwtSource).toMatch(/algorithms:\s*\["EdDSA"\]/);
  });
});
