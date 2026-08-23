import { describe, expect, it } from "vitest";
import animeCss from "../../src/styles/anime.css?raw";
import chatCss from "../../src/styles/chat.css?raw";
import css from "../../src/styles/press-3d.css?raw";
import routeCss from "../../src/styles/route-detail.css?raw";
import { ruleDeclaration, sharedRuleDeclaration } from "./stylesheet-probe";

/**
 * §4.2 of docs/iterations/chat-visual-restore/task.md: pill, ledge, hover lift,
 * pressed sink. Three skins each restated it and chat's copy had only ever
 * declared the sink — the lift, which is the half that tells a pointer user the
 * thing is pressable at all, was missing from all seven of its buttons.
 */
const MEMBERS = [
  ".anime-press",
  ".route-press",
  ".route-goldbar",
  ".chat-error-banner__retry",
  ".chat-fallback__retry",
  ".chat-interruption__retry",
  ".chat-session-expired__login",
  ".chat-session-expired__resume",
  ".chat-budget-exhausted__login",
  ".chat-quota-exhausted__login",
];

describe("§4.2 one pill, one ledge, for every family", () => {
  it.each(MEMBERS)("%s reads its depth off the shared rule", (member) => {
    expect(sharedRuleDeclaration(css, member, "border-radius")).toBe("50px");
    expect(sharedRuleDeclaration(css, member, "box-shadow"))
      .toBe("0 3px 0 0 var(--press-ledge, var(--shadow-3d))");
    expect(sharedRuleDeclaration(css, member, "cursor")).toBe("pointer");
  });

  it.each(MEMBERS)("%s lifts on hover, the half chat was missing", (member) => {
    expect(sharedRuleDeclaration(css, `${member}:hover:not(:disabled)`, "transform"))
      .toBe("translateY(-2px)");
    expect(sharedRuleDeclaration(css, `${member}:hover:not(:disabled)`, "border-color"))
      .toBe("var(--color-primary)");
  });

  it.each(MEMBERS)("%s sinks onto the shallower ledge when pressed", (member) => {
    expect(sharedRuleDeclaration(css, `${member}:active:not(:disabled)`, "transform"))
      .toBe("translateY(2px)");
    expect(sharedRuleDeclaration(css, `${member}:active:not(:disabled)`, "box-shadow"))
      .toBe("0 1px 0 0 var(--press-ledge, var(--shadow-3d))");
  });

  /* The gold bar declared the ledge and the sink itself and got no hover at
   * all — the same half of the pattern chat's seven buttons were missing. It
   * joins the group; only the colour of its step is its own. */
  it("steps the gold bar down onto ITS ledge, the shared rule reading the family's", () => {
    expect(ruleDeclaration(routeCss, ".route-goldbar", "--press-ledge")).toBe("var(--color-gold-deep)");
    expect(routeCss).not.toContain("0 3px 0 0 var(--color-gold-deep)");
    expect(routeCss).not.toContain(".route-goldbar:active");
  });

  it("leaves a family that names no ledge on the cream one", () => {
    expect(ruleDeclaration(animeCss, ".anime-press", "--press-ledge")).toBeNull();
    expect(css).toContain("var(--press-ledge, var(--shadow-3d))");
  });

  it("holds a disabled button still, rather than lifting it under the pointer", () => {
    expect(css).not.toMatch(/:hover(?!:not\(:disabled\))/u);
    expect(css).not.toMatch(/:active(?!:not\(:disabled\))/u);
  });
});

describe("§4.6 the lift and the sink yield to the reduce preference", () => {
  it.each(MEMBERS)("%s loses its transition under reduced motion", (member) => {
    expect(sharedRuleDeclaration(css, member, "transition")).toBe("none");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

describe("no skin keeps a second copy of the depth", () => {
  /* The opposite call from card-plane.css, and for a concrete reason: every
   * family declares its resting edge with the `border` SHORTHAND in its own
   * unlayered sheet, and an unlayered shorthand beats a layered `border-color`
   * however specific. Layered, the hover rule would move the button and drop
   * the teal — half the pattern again. */
  it("stays UNLAYERED, so the hover line outranks each family's border shorthand", () => {
    expect(css).not.toContain("@layer");
  });

  it.each([["anime", animeCss], ["route-detail", routeCss], ["chat", chatCss]])(
    "%s restates neither the ledge nor the sink", (_name, sheet) => {
      expect(sheet).not.toContain("-press:hover");
      expect(sheet).not.toContain("-press:active");
      expect(sheet).not.toContain("0 3px 0 0 var(--shadow-3d)");
    });
});
