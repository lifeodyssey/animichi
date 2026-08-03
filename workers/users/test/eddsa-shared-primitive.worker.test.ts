import { describe, expect, it } from "vitest";
import contractJwtSource from "../../../packages/contract/src/jwt.ts?raw";
import edgeAuthSource from "../../../worker/auth.ts?raw";
import usersJwtSource from "../src/auth/jwt.ts?raw";

/**
 * Neon Auth EdDSA verification lived twice — `worker/auth.ts` (edge `/v1`) and
 * `workers/users/src/auth/jwt.ts` (this service's own JWKS check) each called
 * `jose.jwtVerify` with a hand-typed `algorithms: ["EdDSA"]` restriction. Two
 * engineers keeping the same cryptographic policy in sync by memory is exactly
 * the failure mode iter6 B9 (issue #647) exists to close: both now delegate to
 * `verifyEdDsaJwt` in `@animichi/contract/jwt` (fix(auth): share edge security
 * primitives, 1edb45a5). This guard fails the moment either consumer drifts
 * back to its own inline `algorithms: ["EdDSA"]` — or keeps the import but
 * stops actually calling it, which an import-only check would miss.
 *
 * Second review pass on this guard flagged two holes in the original regex
 * version: it asserted the import existed but never that the imported
 * function was actually *called* (an unused import next to a re-inlined
 * verification would have passed), and its literal ban only matched
 * double-quoted `"EdDSA"`. Both are closed below by checking semantics —
 * import presence, an actual call site, and a quote-agnostic literal scan —
 * on comment-stripped source, so a doc comment merely *mentioning* a name
 * or a literal (like this one) can never masquerade as real usage.
 *
 * A real parser would make this more precise still, but `typescript@7`
 * (this repo's pin) restructured the package around the new native compiler
 * and no longer ships the classic `ts.createSourceFile` API. The surviving
 * fallback, `typescript/unstable/ast`'s tokenizer, was tried here first and
 * reliably OOMs this file's `vitest-pool-workers` isolate:
 *
 *   V8 fatal error; message = : allocation failed: JavaScript heap out of memory
 *
 * (reproduced 2026-08-04, loading `typescript/unstable/ast` inside this same
 * `test/*.worker.test.ts` file — its generated AST/factory modules are too
 * large for the Worker isolate's heap). Falling back to regex checks that are
 * provably quote-agnostic and assert actual usage, not just import shape.
 */
export const READS = [
  "packages/contract/src/jwt.ts",
  "worker/auth.ts",
  "workers/users/src/auth/jwt.ts",
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

const edgeCode = stripComments(edgeAuthSource);
const usersCode = stripComments(usersJwtSource);
const contractCode = stripComments(contractJwtSource);

describe("EdDSA verification stays a single shared primitive (issue #647)", () => {
  it("the edge worker (/v1) imports and calls the shared verifier", () => {
    expect(importsNamedFrom(edgeCode, MODULE, "verifyEdDsaJwt")).toBe(true);
    expect(isCalled(edgeCode, "verifyEdDsaJwt")).toBe(true);
  });

  it("the users worker imports and calls the shared verifier", () => {
    expect(importsNamedFrom(usersCode, MODULE, "verifyEdDsaJwt")).toBe(true);
    expect(isCalled(usersCode, "verifyEdDsaJwt")).toBe(true);
  });

  it("neither consumer hand-rolls its own EdDSA algorithm restriction (any quote style)", () => {
    // `worker/auth.ts` legitimately reads a JWT header's `alg` field to decide
    // *whether* to route to the Neon verifier — that is routing logic, not a
    // second implementation of the crypto policy. What must never reappear is
    // an inline `algorithms: [...]` array containing "EdDSA", the literal
    // duplication `verifyEdDsaJwt` replaced.
    expect(hasInlineEdDsaAlgorithms(edgeCode)).toBe(false);
    expect(hasInlineEdDsaAlgorithms(usersCode)).toBe(false);
  });

  it("the shared primitive is still the one place EdDSA is pinned", () => {
    expect(hasInlineEdDsaAlgorithms(contractCode)).toBe(true);
  });
});
