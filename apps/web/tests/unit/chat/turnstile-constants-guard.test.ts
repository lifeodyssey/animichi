import constantsSource from "../../../../../packages/contract/src/constants.ts?raw";
import edgeTurnstileSource from "../../../../../worker/turnstile.ts?raw";
import { describe, expect, it } from "vitest";
import tokenStoreSource from "../../../src/lib/turnstile/tokenStore.ts?raw";

/**
 * The Turnstile header name and TTL/window relationship lived once in the edge
 * worker (`worker/turnstile.ts`) and once in this app's token store, kept in
 * sync only by a comment cross-reference. Both now import
 * `TURNSTILE_HEADER` / `TURNSTILE_WINDOW_MS` / `TURNSTILE_TOKEN_TTL_MS` from
 * `@animichi/contract/constants` (fix(auth): share edge security primitives,
 * 1edb45a5) — this iter6 B9 (issue #647) guard fails the moment either side
 * reverts to a hand-typed literal instead of the shared import, which is
 * exactly how the two would silently drift again.
 */
export const READS = [
  "packages/contract/src/constants.ts",
  "worker/turnstile.ts",
  "apps/web/src/lib/turnstile/tokenStore.ts",
] as const;

const IMPORTS_SHARED_CONSTANTS =
  /import\s*\{[^}]*\bTURNSTILE_HEADER\b[^}]*\}\s*from\s*["']@animichi\/contract\/constants["']/;

describe("Turnstile constants stay in the shared contract package (issue #647)", () => {
  it("the edge worker imports the shared header + window constants", () => {
    expect(edgeTurnstileSource).toMatch(IMPORTS_SHARED_CONSTANTS);
    expect(edgeTurnstileSource).toMatch(/\bTURNSTILE_WINDOW_MS\b/);
  });

  it("the web token store imports the shared header + TTL constants", () => {
    expect(tokenStoreSource).toMatch(IMPORTS_SHARED_CONSTANTS);
    expect(tokenStoreSource).toMatch(/\bTURNSTILE_TOKEN_TTL_MS\b/);
  });

  it("neither consumer hand-rolls the wire header name as a literal", () => {
    expect(edgeTurnstileSource).not.toContain('"cf-turnstile-response"');
    expect(tokenStoreSource).not.toContain('"cf-turnstile-response"');
  });

  it("the shared constant is still the one place the header literal lives", () => {
    expect(constantsSource).toContain('TURNSTILE_HEADER = "cf-turnstile-response"');
  });

  it("the token TTL is still derived from the window, not a second literal", () => {
    expect(constantsSource).toMatch(
      /TURNSTILE_TOKEN_TTL_MS\s*=\s*TURNSTILE_WINDOW_MS\s*-\s*60_000/,
    );
  });
});
