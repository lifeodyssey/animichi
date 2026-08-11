import { describe, expect, it } from "vitest";
import contractJwtSource from "../../../packages/contract/src/jwt.ts?raw";
import edgeAuthSource from "../../../workers/edge/src/identity/auth.ts?raw";
import usersIndexSource from "../src/index.ts?raw";

/**
 * Neon Auth EdDSA verification used to live twice — `workers/edge/identity/auth.ts`
 * (edge `/v1`) and `workers/users/src/auth/jwt.ts` (the users service's own JWKS
 * check) each called `jose.jwtVerify` with a hand-typed `algorithms: ["EdDSA"]`
 * restriction. Two engineers keeping the same cryptographic policy in sync by
 * memory is exactly the failure mode iter6 B9 (issue #647) exists to close;
 * both used to delegate to `verifyEdDsaJwt` in `@animichi/contract/jwt`
 * (fix(auth): share edge security primitives, 1edb45a5).
 *
 * AUTH-2 #950 deleted the users-side verifier: the users service no longer
 * verifies JWTs at all — the edge verifies (this guard pins that) and forwards
 * only the verified identity over the service binding. This guard therefore
 * asserts:
 *
 *  1. the edge still imports and *calls* the shared verifier;
 *  2. the edge pins no inline EdDSA algorithm list of its own;
 *  3. the users worker never re-introduces a verifier (no `verifyEdDsaJwt`
 *     import, no `createRemoteJWKSet`, no inline EdDSA algorithm array).
 *
 * Import presence is not enough for (1): an unused import next to a re-inlined
 * verification would pass, so the guard also checks an actual call site. All
 * checks run on comment-stripped source so a doc comment merely *mentioning* a
 * name or a literal (like this one) can never masquerade as real usage.
 */
export const READS = [
  "packages/contract/src/jwt.ts",
  "workers/edge/src/identity/auth.ts",
  "workers/users/src/index.ts",
] as const;

const MODULE = "@animichi/contract/jwt";

/**
 * Comments removed, string/template literals left intact. A naive
 * line-comment regex would truncate a `"https://..."` literal at its `//`,
 * so string/template literals are matched as whole alternatives *before*
 * the comment alternatives — the regex engine consumes an entire literal in
 * one match, so a `//` or `/*` inside it is never seen as its own token.
 */
const LITERAL_OR_COMMENT =
  /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

function stripComments(source: string): string {
  return source.replace(LITERAL_OR_COMMENT, (match) =>
    match.startsWith("//") || match.startsWith("/*") ? "" : match,
  );
}

function importsNamedFrom(code: string, moduleSpecifier: string, name: string): boolean {
  const escapedModule = moduleSpecifier.replaceAll("/", String.raw`\/`);
  const re = new RegExp(String.raw`import\s*\{([^}]*)\}\s*from\s*['"]${escapedModule}['"]`, "g");
  for (const match of code.matchAll(re)) {
    const names = (match[1] ?? "").split(",").map((entry) => entry.trim());
    if (names.includes(name)) return true;
  }
  return false;
}

/** `name` is called as a function — an identifier immediately followed by `(`. */
function isCalled(code: string, name: string): boolean {
  return new RegExp(String.raw`\b${name}\s*\(`).test(code);
}

/** An `algorithms: [...]` object-literal property whose array contains "EdDSA". */
function hasInlineEdDsaAlgorithms(code: string): boolean {
  const arrays = code.matchAll(/algorithms\s*:\s*\[([^\]]*)\]/g);
  for (const match of arrays) {
    if (/['"`]EdDSA['"`]/.test(match[1] ?? "")) return true;
  }
  return false;
}

/** The users worker must not re-introduce any JWT verification primitive. */
function hasJwtVerifierCode(code: string): boolean {
  return importsNamedFrom(code, MODULE, "verifyEdDsaJwt") ||
    code.includes("createRemoteJWKSet") ||
    hasInlineEdDsaAlgorithms(code);
}

const edgeCode = stripComments(edgeAuthSource);
const usersCode = stripComments(usersIndexSource);
const contractCode = stripComments(contractJwtSource);

describe("EdDSA verification stays a single shared primitive at the edge (issue #647, AUTH-2 #950)", () => {
  it("the edge worker (/v1 + /v1/users) imports and calls the shared verifier", () => {
    expect(importsNamedFrom(edgeCode, MODULE, "verifyEdDsaJwt")).toBe(true);
    expect(isCalled(edgeCode, "verifyEdDsaJwt")).toBe(true);
  });

  it("the edge does not hand-roll its own EdDSA algorithm restriction (any quote style)", () => {
    expect(hasInlineEdDsaAlgorithms(edgeCode)).toBe(false);
  });

  it("the users worker no longer verifies JWTs itself — no verifier code", () => {
    expect(hasJwtVerifierCode(usersCode)).toBe(false);
  });

  it("the shared primitive is still the one place EdDSA is pinned", () => {
    expect(hasInlineEdDsaAlgorithms(contractCode)).toBe(true);
  });
});
