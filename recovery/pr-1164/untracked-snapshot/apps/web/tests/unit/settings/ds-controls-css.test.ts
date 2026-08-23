import { describe, expect, it } from "vitest";
import globalsCss from "../../../src/styles/globals.css?raw";
import { parseBlockTokens, parseTokens, ruleDeclaration, tokenValue } from "../stylesheet-probe";

/**
 * The two settings controls are transcribed from the upstream design system
 * (docs/design/animal-island-ref/component-specs.md). These pin the geometry
 * the spec states in pixels and the token indirection the sheet's own rule
 * demands — a raw hex inside a control rule is the regression this catches.
 */
const tokens = parseTokens(globalsCss);
const nightTokens = parseBlockTokens(globalsCss, '[data-theme="night"]');

describe("Switch geometry (component-specs.md §Switch, default size)", () => {
  it.each([
    ["width", "52px"],
    ["height", "28px"],
    ["border-radius", "50px"],
  ])("pins the track %s to %s", (property, expected) => {
    expect(ruleDeclaration(globalsCss, ".ds-switch__track", property)).toBe(expected);
  });

  it("pins the 2.5px track border", () => {
    expect(ruleDeclaration(globalsCss, ".ds-switch__track", "border")).toContain("2.5px");
  });

  it.each([
    ["width", "21px"],
    ["height", "21px"],
    ["border-radius", "50%"],
  ])("pins the handle %s to %s", (property, expected) => {
    expect(ruleDeclaration(globalsCss, ".ds-switch__handle", property)).toBe(expected);
  });

  it("floats the handle in BOTH positions, never only in one", () => {
    expect(ruleDeclaration(globalsCss, ".ds-switch__handle", "transform")).toBe("translateY(-2px)");
    expect(ruleDeclaration(globalsCss, '.ds-switch[aria-checked="true"] .ds-switch__handle', "transform"))
      .toBe("translate(24px, -2px)");
  });
});

describe("Switch colour, focus and motion", () => {
  it.each([
    ["--color-switch-off", "#d4c9b4"],
    ["--color-switch-off-border", "#c4b89e"],
    ["--color-switch-on", "#86d67a"],
    ["--color-success-deep", "#5a9e1e"],
  ])("pins %s to the upstream value %s", (token, expected) => {
    expect(tokenValue(tokens, token)).toBe(expected);
  });

  it("reuses the existing success token for the ON border rather than a copy", () => {
    expect(tokenValue(tokens, "--color-success-fg")).toBe("#6fba2c");
    expect(ruleDeclaration(globalsCss, '.ds-switch[aria-checked="true"] .ds-switch__track', "border-color"))
      .toBe("var(--color-success-fg)");
  });

  it("reuses --shadow-3d for the OFF ledge, whose value already matches", () => {
    expect(tokenValue(tokens, "--shadow-3d")).toBe("#bdaea0");
    expect(ruleDeclaration(globalsCss, ".ds-switch__handle", "box-shadow")).toBe("0 3px 0 0 var(--shadow-3d)");
  });

  it("takes the focus ring from the focus token, whose value is the DS yellow", () => {
    expect(tokenValue(tokens, "--color-focus")).toBe("#ffcc00");
    expect(ruleDeclaration(globalsCss, ".ds-switch:focus-visible", "outline")).toBe("2px solid var(--color-focus)");
    expect(ruleDeclaration(globalsCss, ".ds-switch:focus-visible", "outline-offset")).toBe("2px");
  });

  it("answers a press immediately and moves in 160ms ease-out — no spring", () => {
    expect(ruleDeclaration(globalsCss, ".ds-switch:active .ds-switch__track", "transform")).toBe("scale(0.97)");
    expect(ruleDeclaration(globalsCss, ".ds-switch__handle", "transition")).toContain("transform 160ms ease-out");
  });

  it("re-grounds only the OFF track at night; the knob and ON ground are brand parts", () => {
    expect(tokenValue(nightTokens, "--color-switch-off")).not.toBe(tokenValue(tokens, "--color-switch-off"));
    expect(nightTokens["--color-switch-on"]).toBeUndefined();
    expect(nightTokens["--color-switch-handle"]).toBeUndefined();
  });
});

describe("Select geometry (component-specs.md §Select)", () => {
  it.each([
    ["padding", "8px 13px"],
    ["border-radius", "12px"],
  ])("pins the trigger %s to %s", (property, expected) => {
    expect(ruleDeclaration(globalsCss, ".ds-select__trigger", property)).toBe(expected);
  });

  it("pins the soft-yellow dropdown the DS calls distinctive", () => {
    expect(tokenValue(tokens, "--color-menu")).toBe("#ffeea0");
    expect(ruleDeclaration(globalsCss, ".ds-select__menu", "background")).toBe("var(--color-menu)");
    expect(ruleDeclaration(globalsCss, ".ds-select__menu", "border-radius")).toBe("28px");
    expect(ruleDeclaration(globalsCss, ".ds-select__menu", "padding")).toBe("12px 0");
    expect(ruleDeclaration(globalsCss, ".ds-select__menu", "animation")).toBe("ds-select-in 0.2s ease");
  });

  it("pins the option padding and the bolder hovered/active option", () => {
    expect(ruleDeclaration(globalsCss, ".ds-select__option", "padding")).toBe("10px 30px 10px 14px");
    expect(ruleDeclaration(globalsCss, ".ds-select__option:hover", "font-weight")).toBe("700");
  });

  it("draws the 14px gold pill bar behind the option in force", () => {
    const bar = '.ds-select__option[aria-selected="true"]::before';
    expect(ruleDeclaration(globalsCss, bar, "height")).toBe("14px");
    expect(ruleDeclaration(globalsCss, bar, "border-radius")).toBe("7px");
    expect(tokenValue(tokens, "--color-menu-marker")).toBe("rgb(255 204 0 / 30%)");
  });

  it("rides the validated solid-gold ink, so the yellow needs no night override", () => {
    expect(ruleDeclaration(globalsCss, ".ds-select__menu", "color")).toBe("var(--color-gold-ink)");
    expect(nightTokens["--color-menu"]).toBeUndefined();
  });
});

describe("both controls clear the repo's 44px touch floor", () => {
  it.each([".ds-switch", ".ds-select__trigger"])("%s declares a 44px min-height", (selector) => {
    expect(ruleDeclaration(globalsCss, selector, "min-height")).toBe("44px");
  });
});
