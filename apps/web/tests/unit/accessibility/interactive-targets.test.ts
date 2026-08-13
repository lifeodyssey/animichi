import { describe, expect, it } from "vitest";
import globalsCss from "../../../src/styles/globals.css?raw";
import { ruleDeclaration } from "../_token-helpers";

/**
 * WCAG 2.5.8 Target Size (Minimum): 24x24 CSS px for user-actuated controls.
 * Inline text links are the WCAG-sanctioned "inline exception", so links are
 * deliberately NOT in the floor selector — buttons, inputs and role=button
 * controls (the targets users actually click) are.
 */
describe("interactive target size: global 24px floor", () => {
  const selector = 'button, input, select, textarea, [role="button"]';

  it("declares a min-height floor for clickable controls", () => {
    const minHeight = ruleDeclaration(globalsCss, selector, "min-height");
    expect(minHeight).not.toBeNull();
    expect(Number.parseFloat(minHeight ?? "0")).toBeGreaterThanOrEqual(24);
  });

  it("does not force the floor onto inline text links (WCAG inline exception)", () => {
    // No rule may grant a[href] the 24px min-height floor.
    const linkFloor = /a\[href\][^{]*\{[^}]*min-height\s*:/.test(globalsCss);
    expect(linkFloor).toBe(false);
  });
});
