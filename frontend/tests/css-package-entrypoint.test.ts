/**
 * A1: Package CSS entrypoint — unit tests
 *
 * Verifies that:
 * 1. globals.css imports from package dist path (not the vendored file)
 * 2. Every design --animal-* token referenced in globals.css is defined in the package CSS
 * 3. The package CSS contains font-face declarations for ja/en/zh glyph stacks
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const GLOBALS_CSS = resolve(ROOT, "app/globals.css");
// core.css = all --animal-* tokens without decorative asset url() references
// index.css = core.css + fonts.css (woff2 font-face; handled by next/font in layout.tsx)
const PACKAGE_CORE_CSS = resolve(ROOT, "node_modules/animal-island-ui/dist/core.css");
const PACKAGE_INDEX_CSS = resolve(ROOT, "node_modules/animal-island-ui/dist/index.css");
const VENDORED_CSS = resolve(ROOT, "app/animal-island-ui.css");

const globalsContent = readFileSync(GLOBALS_CSS, "utf8");
const packageCssContent = readFileSync(PACKAGE_CORE_CSS, "utf8");
const packageIndexContent = readFileSync(PACKAGE_INDEX_CSS, "utf8");

describe("A1: CSS package entrypoint adoption", () => {
  it("globals.css imports animal-island-ui core CSS via package style/core entrypoint", () => {
    expect(globalsContent).toMatch(/@import\s+['"]animal-island-ui\/style\/core['"]/);
  });

  it("globals.css does not import the vendored ./animal-island-ui.css", () => {
    expect(globalsContent).not.toMatch(/@import\s+['"]\.\/animal-island-ui\.css['"]/);
  });

  it("vendored animal-island-ui.css file no longer exists in app/", () => {
    expect(existsSync(VENDORED_CSS)).toBe(false);
  });

  it("package CSS defines --animal-warning-color (CTA gold token)", () => {
    expect(packageCssContent).toContain("--animal-warning-color:");
  });

  it("package CSS defines --animal-primary-color (teal #19c8b9)", () => {
    expect(packageCssContent).toContain("--animal-primary-color:#19c8b9");
  });

  it("boundary: design --animal-* tokens referenced in globals.css :root rules are defined in package CSS", () => {
    // Component-scoped props (--animal-button-*) are set per-element by the package's JS/class
    // system, not in :root. Only design tokens (warning, primary, text, error) must be root-defined.
    const requiredTokens = [
      "--animal-warning-color",
      "--animal-warning-color-hover",
      "--animal-warning-color-active",
      "--animal-text-color",
      "--animal-primary-color",
    ];

    const missing = requiredTokens.filter(
      (token) => !packageCssContent.includes(`${token}:`)
    );
    expect(missing, `Missing design tokens in package CSS: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("i18n: package index.css (fonts included) contains font-face for Nunito (en/latin body)", () => {
    // core.css = tokens only; index.css = core + fonts. Font-face for Nunito is in package fonts.
    expect(packageIndexContent).toContain("font-family:Nunito");
  });

  it("i18n: package index.css contains font-face for Noto Sans SC (zh glyphs)", () => {
    expect(packageIndexContent).toContain("font-family:Noto Sans SC");
  });

  it("i18n: layout.tsx loads Nunito, Noto_Sans_SC, Noto_Serif_JP, Zen_Maru_Gothic via next/font", () => {
    const LAYOUT_TSX = resolve(ROOT, "app/layout.tsx");
    const layoutContent = readFileSync(LAYOUT_TSX, "utf8");
    expect(layoutContent).toContain("Nunito");
    expect(layoutContent).toContain("Noto_Sans_SC");
    expect(layoutContent).toContain("Noto_Serif_JP");
    expect(layoutContent).toContain("Zen_Maru_Gothic");
  });
});
