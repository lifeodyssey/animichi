import { describe, expect, it } from "vitest";
import constantsSource from "../../../../../packages/contract/src/constants.ts?raw";
import edgeTurnstileSource from "../../../../../workers/edge/turnstile.ts?raw";
import tokenStoreSource from "../../../src/lib/turnstile/token-store.ts?raw";

/**
 * The Turnstile header name and TTL/window relationship lived once in the edge
 * worker (`workers/edge/turnstile.ts`) and once in this app's token store, kept in
 * sync only by a comment cross-reference. Both now import
 * `TURNSTILE_HEADER` / `TURNSTILE_WINDOW_MS` / `TURNSTILE_TOKEN_TTL_MS` from
 * `@animichi/contract/constants` (fix(auth): share edge security primitives,
 * 1edb45a5). This iter6 B9 (issue #647) guard fails the moment either side
 * reverts to a hand-typed literal instead of the shared import.
 *
 * Second review pass on this guard flagged that a plain "does the file
 * contain this substring" check has real holes: it only checked ONE of the
 * three constants, and a `"..."`-only literal ban is dodged by switching
 * quotes. Judged semantically instead, on comment-stripped source (a doc
 * comment mentioning a constant's name in prose must not count as "using"
 * it — this file's own comments do exactly that, which is why stripping
 * matters and not just an abstract concern):
 *   - each constant is checked individually — imported from the contract
 *     module AND referenced again beyond that import line, in actual code;
 *   - literal bans match any quote style (`'`, `"`, or a template literal).
 *
 * `typescript@7` (this repo's pin) restructured the package around the new
 * native compiler and dropped the classic `ts.createSourceFile` tree-walking
 * API; the surviving fallback (`typescript/unstable/ast`'s scanner) OOMs the
 * `vitest-pool-workers` isolate used by the sibling EdDSA guard in
 * `workers/users` (verified: `JavaScript heap out of memory`). To keep both
 * guards on one technique, this file uses the same regex-based semantic
 * checks rather than a real parser — see that guard's block comment for the
 * full rationale.
 */
export const READS = [
  "packages/contract/src/constants.ts",
  "workers/edge/turnstile.ts",
  "apps/web/src/lib/turnstile/token-store.ts",
] as const;

const MODULE = "@animichi/contract/constants";
const QUOTED = (literal: string): RegExp => new RegExp(`['"\`]${literal}['"\`]`);

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

/** How many times `name` appears as a standalone word in comment-free `code`. */
function occurrenceCount(code: string, name: string): number {
  return [...code.matchAll(new RegExp(String.raw`\b${name}\b`, "g"))].length;
}

/**
 * `code` with every `import { ... } from "..."` and `export { ... }` line
 * removed — a bare re-export (this file has one) mentions the name without
 * ever *using* it, so it must not count toward "genuinely referenced".
 */
function withoutImportExportLines(code: string): string {
  return code
    .replaceAll(/import\s*\{[^}]*\}\s*from\s*['"][^'"]*['"];?/g, "")
    .replaceAll(/export\s*\{[^}]*\};?/g, "");
}

/** `name` is imported from the module AND referenced in code beyond that. */
function isRealConsumer(code: string, name: string): boolean {
  return importsNamedFrom(code, MODULE, name) && occurrenceCount(withoutImportExportLines(code), name) > 0;
}

/** Every quoted-literal value (single/double/template, no interpolation) in `code`. */
function stringLiteralValues(code: string): Set<string> {
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`/g;
  const values = new Set<string>();
  for (const match of code.matchAll(re)) values.add(match[1] ?? match[2] ?? match[3] ?? "");
  return values;
}

const edgeCode = stripComments(edgeTurnstileSource);
const tokenStoreCode = stripComments(tokenStoreSource);
const constantsCode = stripComments(constantsSource);

describe("Turnstile constants stay in the shared contract package (issue #647)", () => {
  it("the edge worker imports and genuinely uses TURNSTILE_HEADER and TURNSTILE_WINDOW_MS", () => {
    expect(isRealConsumer(edgeCode, "TURNSTILE_HEADER")).toBe(true);
    expect(isRealConsumer(edgeCode, "TURNSTILE_WINDOW_MS")).toBe(true);
  });

  it("the web token store imports and genuinely uses TURNSTILE_HEADER and TURNSTILE_TOKEN_TTL_MS", () => {
    expect(isRealConsumer(tokenStoreCode, "TURNSTILE_HEADER")).toBe(true);
    expect(isRealConsumer(tokenStoreCode, "TURNSTILE_TOKEN_TTL_MS")).toBe(true);
  });

  it("neither consumer hand-rolls the wire header name as a literal (any quote style)", () => {
    expect(QUOTED("cf-turnstile-response").test(edgeCode)).toBe(false);
    expect(QUOTED("cf-turnstile-response").test(tokenStoreCode)).toBe(false);
  });

  it("the shared constant is still the one place the header literal lives", () => {
    expect(stringLiteralValues(constantsCode)).toContain("cf-turnstile-response");
  });

  it("the token TTL is still derived from the window, not a second literal", () => {
    // TURNSTILE_WINDOW_MS must appear at least twice in constants.ts: once for
    // its own declaration and once as the right-hand side TTL derives from.
    expect(occurrenceCount(constantsCode, "TURNSTILE_WINDOW_MS")).toBeGreaterThan(1);
  });
});
