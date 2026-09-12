import { describe, expect, it } from "vitest";
import animalCss from "animal-island-ui-tailwind/dist/index.css?raw";
import { animalButtonClass } from "../../src/features/chat/components/AnimalButton";
import animeCss from "../../src/styles/anime.css?raw";
import chatCss from "../../src/styles/chat.css?raw";
import css from "../../src/styles/press-3d.css?raw";
import routeCss from "../../src/styles/route-detail.css?raw";
import { ruleDeclaration, sharedRuleDeclaration } from "./stylesheet-probe";

/**
 * §4.2 of docs/iterations/chat-visual-restore/task.md: pill, ledge, hover lift,
 * pressed sink. Anime and route retain their shared app rule; chat actions now
 * consume the Animal Island Button class contract through AnimalButton.
 */
const MEMBERS = [
  ".anime-press",
  ".route-press",
  ".route-goldbar",
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

describe("chat actions consume the Animal Island press contract", () => {
  const classes = animalButtonClass();

  it("keeps the library grammar, cream tone, 44px floor and wrapped labels", () => {
    expect(classes.split(" ")).toEqual(expect.arrayContaining(["animal-btn", "animal-btn-middle", "animal-btn-primary"]));
    expect(classes).toContain("[--animal-bg-color:var(--color-paper)]");
    expect(classes).toContain("[--animal-bg-color-secondary:var(--color-muted)]");
    expect(classes).toContain("[min-height:44px]");
    expect(classes).toContain("[white-space:normal]");
  });

  it("uses the library's full resting, hover and pressed depth", () => {
    expect(ruleDeclaration(animalCss, ".animal-btn-primary", "box-shadow")).toBe("var(--animal-shadow-press)");
    expect(ruleDeclaration(animalCss, ".animal-btn-primary:hover:not(:disabled)", "box-shadow")).toBe("var(--animal-shadow-press-hover)");
    expect(ruleDeclaration(animalCss, ".animal-btn-primary:active:not(:disabled)", "box-shadow")).toBe("var(--animal-shadow-press-active)");
  });

  it("keeps disabled controls still and reduced motion transition-free", () => {
    expect(sharedRuleDeclaration(animalCss, ".animal-btn:disabled", "box-shadow")).toBe("none");
    expect(classes).toContain("motion-reduce:transition-none");
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
