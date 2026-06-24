/**
 * A2: Token-alignment contract test (package = source of truth)
 *
 * Strategy: parse CSS files directly — jsdom does not compute custom properties,
 * so getComputedStyle returns empty strings for --custom-property references.
 *
 * The package owns --animal-* primitives via animal-island-ui/dist/core.css.
 * The app owns --color-* semantic aliases in app/globals.css :root.
 * Documented equalities and reference relationships are asserted here so a
 * package bump that shifts a token value fails CI rather than silently desyncing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const GLOBALS_CSS = resolve(ROOT, "app/globals.css");
const PACKAGE_CORE_CSS = resolve(ROOT, "node_modules/animal-island-ui/dist/core.css");

function extractTokenValue(css: string, tokenName: string): string {
  // Match --token-name: value; inside :root or bare declarations
  const pattern = new RegExp(
    `${tokenName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;}{]+?)\\s*;`
  );
  const match = css.match(pattern);
  return match?.[1]?.trim() ?? "";
}

const globalsContent = readFileSync(GLOBALS_CSS, "utf8");
const packageContent = readFileSync(PACKAGE_CORE_CSS, "utf8");

describe("A2: Token-alignment contract — package is source of truth", () => {
  describe("Happy path: documented equalities hold", () => {
    it("--color-primary equals --animal-primary-color (teal #19c8b9)", () => {
      const appValue = extractTokenValue(globalsContent, "--color-primary");
      const pkgValue = extractTokenValue(packageContent, "--animal-primary-color");

      expect(appValue).toBeTruthy();
      expect(pkgValue).toBeTruthy();
      expect(appValue).toBe(pkgValue);
    });

    it("--color-error-fg equals --animal-error-color-active (#c94444)", () => {
      const appValue = extractTokenValue(globalsContent, "--color-error-fg");
      const pkgValue = extractTokenValue(packageContent, "--animal-error-color-active");

      expect(appValue).toBeTruthy();
      expect(pkgValue).toBeTruthy();
      expect(appValue).toBe(pkgValue);
    });

    it("--color-bg equals --animal-bg-color (ground #f8f8f0)", () => {
      const appValue = extractTokenValue(globalsContent, "--color-bg");
      const pkgValue = extractTokenValue(packageContent, "--animal-bg-color");

      expect(appValue).toBeTruthy();
      expect(pkgValue).toBeTruthy();
      expect(appValue).toBe(pkgValue);
    });

    it("--color-card equals --animal-bg-color-content (surface #f7f3df)", () => {
      const appValue = extractTokenValue(globalsContent, "--color-card");
      const pkgValue = extractTokenValue(packageContent, "--animal-bg-color-content");

      expect(appValue).toBeTruthy();
      expect(pkgValue).toBeTruthy();
      expect(appValue).toBe(pkgValue);
    });

    it("CTA button class in globals.css directly references var(--animal-warning-color)", () => {
      // --color-cta is an app-managed token; the animal-btn-cta rule consumes the
      // package token directly so the rendered CTA color is always from the package.
      expect(globalsContent).toContain("var(--animal-warning-color)");
      expect(globalsContent).toMatch(/animal-btn-cta[\s\S]*?var\(--animal-warning-color\)/);
    });

    it("--animal-warning-color is defined in package CSS (CTA source)", () => {
      const pkgValue = extractTokenValue(packageContent, "--animal-warning-color");
      expect(pkgValue).toBeTruthy();
    });
  });

  describe("Null/empty: missing variable causes a clear failure", () => {
    it("extractTokenValue returns empty string when token is absent (detection mechanism)", () => {
      const result = extractTokenValue(":root { --other: red; }", "--color-primary");
      // Empty string triggers the .toBeTruthy() guard in the happy-path tests:
      // those tests call expect(appValue).toBeTruthy() before the equality check.
      expect(result).toBe("");
    });

    it("real globals.css --color-primary is non-empty (guard against vendored file removal)", () => {
      const value = extractTokenValue(globalsContent, "--color-primary");
      expect(value, "EMPTY: --color-primary not found in globals.css — token was removed or renamed").not.toBe("");
    });

    it("real package core.css --animal-primary-color is non-empty (guard against package rename)", () => {
      const value = extractTokenValue(packageContent, "--animal-primary-color");
      expect(value, "EMPTY: --animal-primary-color not found in package core.css — package token was removed or renamed").not.toBe("");
    });
  });

  describe("Error path: deliberate mismatch proves contract can fail", () => {
    it("detects value mismatch between app token and package token (fixture)", () => {
      // This fixture simulates a package bump that changed --animal-primary-color
      // without updating --color-primary in globals.css.
      const brokenPackageCss = `
        :root {
          --animal-primary-color: #00ff00;
        }
      `;
      const brokenAppCss = `
        :root {
          --color-primary: #19c8b9;
        }
      `;

      const appValue = extractTokenValue(brokenAppCss, "--color-primary");
      const pkgValue = extractTokenValue(brokenPackageCss, "--animal-primary-color");

      // This assertion FAILS intentionally in the fixture — proving the contract detects drift.
      // We invert the expectation here to prove the mismatch would be caught.
      expect(appValue).not.toBe(pkgValue);
    });

    it("detects missing token as a contract violation (fixture)", () => {
      const missingTokenCss = `:root { --color-other: red; }`;
      const value = extractTokenValue(missingTokenCss, "--color-primary");

      // Empty string means the token is absent — the contract would fail.
      expect(value).toBe("");

      // Prove the equality check would fire:
      const pkgValue = "#19c8b9";
      expect(value).not.toBe(pkgValue);
    });
  });
});
