import { describe, expect, it } from "vitest";
import animeCss from "../../src/styles/anime.css?raw";
import css from "../../src/styles/card-plane.css?raw";
import chatCss from "../../src/styles/chat.css?raw";
import globalsCss from "../../src/styles/globals.css?raw";
import routeCss from "../../src/styles/route-detail.css?raw";
import shioriCss from "../../src/styles/shiori.css?raw";
import { sharedRuleDeclaration } from "./stylesheet-probe";

/**
 * §4.1 of docs/iterations/chat-visual-restore/task.md, declared once for the
 * four card families that used to restate it — which is how chat's drop shadow
 * drifted onto a `--shadow-3d` mix (a cream by day, near-black at night) while
 * the other three kept the spec's deep brown.
 */
const FAMILY = [".anime-card", ".chat-card", ".route-card", ".shiori-card"];

describe("§4.1 the card plane is declared once", () => {
  it.each(FAMILY)("%s reads its plane off the shared rule", (member) => {
    expect(sharedRuleDeclaration(css, member, "background")).toBe("var(--color-paper)");
    expect(sharedRuleDeclaration(css, member, "border")).toBe("2px solid var(--color-border-soft)");
    expect(sharedRuleDeclaration(css, member, "border-radius")).toBe("18px");
    expect(sharedRuleDeclaration(css, member, "overflow")).toBe("hidden");
  });

  it("floats every card on the SAME deep brown, never a theme-flipping mix", () => {
    // A token here would follow the theme; the four skins must not diverge again,
    // so the literal itself is the contract — a missing rule fails as a null.
    expect(sharedRuleDeclaration(css, ".chat-card", "box-shadow"))
      .toBe("0 14px 30px -20px rgb(90 60 32 / 40%)");
  });

  it("lands every card on the one shared cardPop", () => {
    expect(sharedRuleDeclaration(css, ".anime-card", "animation"))
      .toBe("card-pop 0.4s cubic-bezier(0.2, 0.8, 0.3, 1) both");
    expect(globalsCss).toContain("@keyframes card-pop");
  });

  it("states the plane exactly once, as one rule and not four", () => {
    expect([...css.matchAll(/\{/gu)]).toHaveLength(2);
  });
});

describe("the layer is what keeps each family's own modifiers winning", () => {
  it("puts the shared plane in a cascade layer, where unlayered rules outrank it", () => {
    expect(css).toContain("@layer components {");
  });

  it.each([
    ["skeleton pulse", chatCss, ".chat-card--skeleton"],
    ["fallback ground", chatCss, ".chat-card--fallback"],
    ["poster export ground", shioriCss, ".shiori-card--poster-fallback"],
  ])("leaves %s unlayered, so it still beats the plane", (_name, sheet, selector) => {
    expect(sheet).toContain(`${selector} {`);
    expect(sheet).not.toContain("@layer");
  });
});

describe("no family keeps a second copy of the plane", () => {
  it.each([
    ["anime", animeCss],
    ["chat", chatCss],
    ["route-detail", routeCss],
    ["shiori", shioriCss],
  ])("%s no longer restates the drop shadow", (_name, sheet) => {
    expect(sheet).not.toContain("30px -20px");
    expect(sheet).not.toContain("card-pop 0.4s");
  });
});
