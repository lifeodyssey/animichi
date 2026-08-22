import { describe, expect, it } from "vitest";
import css from "../../../src/styles/anime.css?raw";
import { ruleDeclaration } from "../stylesheet-probe";

/**
 * The `/anime/$bangumiId` skin against the design-sync canvas
 * ("作品公開页 demo.html", 図鑑型) and the six shared visual languages
 * (docs/iterations/chat-visual-restore/task.md §4).
 */
describe("§4.1 card language", () => {
  it("draws every card as 2px line, 18px radius, clipped paper", () => {
    expect(ruleDeclaration(css, ".anime-card", "border")).toBe("2px solid var(--color-border-soft)");
    expect(ruleDeclaration(css, ".anime-card", "border-radius")).toBe("18px");
    expect(ruleDeclaration(css, ".anime-card", "background")).toBe("var(--color-paper)");
    expect(ruleDeclaration(css, ".anime-card", "overflow")).toBe("hidden");
  });

  it("floats the card on the warm drop shadow instead of a hard edge", () => {
    expect(ruleDeclaration(css, ".anime-card", "box-shadow")).toBe("0 14px 30px -20px rgb(90 60 32 / 40%)");
  });

  it("enters with cardPop on the shared curve", () => {
    expect(ruleDeclaration(css, ".anime-card", "animation"))
      .toBe("anime-card-pop 0.4s cubic-bezier(0.2, 0.8, 0.3, 1) both");
    expect(css).toContain("transform: translateY(10px) scale(0.985)");
  });

  it("grounds the nested fact panel on the panel cream, not on the card's paper", () => {
    expect(ruleDeclaration(css, ".anime-fact", "background")).toBe("var(--color-card)");
  });
});

describe("§4.2 3D press button", () => {
  it("wears the pill shape on the cream 3D step", () => {
    expect(ruleDeclaration(css, ".anime-press", "border-radius")).toBe("50px");
    expect(ruleDeclaration(css, ".anime-press", "font-weight")).toBe("800");
    expect(ruleDeclaration(css, ".anime-press", "box-shadow")).toBe("0 3px 0 0 var(--shadow-3d)");
  });

  it("sinks into its own shadow when pressed", () => {
    expect(ruleDeclaration(css, ".anime-press:active", "transform")).toBe("translateY(2px)");
    expect(ruleDeclaration(css, ".anime-press:active", "box-shadow")).toBe("0 1px 0 0 var(--shadow-3d)");
  });

  it("lifts and turns teal on hover", () => {
    expect(ruleDeclaration(css, ".anime-press:hover", "transform")).toBe("translateY(-2px)");
    expect(ruleDeclaration(css, ".anime-press:hover", "border-color")).toBe("var(--color-primary)");
  });

  it("keeps the operable border loud, since WCAG 1.4.11 governs a control edge", () => {
    expect(ruleDeclaration(css, ".anime-press", "border")).toBe("2px solid var(--color-border)");
    expect(ruleDeclaration(css, ".anime-press", "min-height")).toBe("44px");
  });
});

describe("§4.3 pill labels", () => {
  it("keeps pills round, heavy and unbreakable", () => {
    expect(ruleDeclaration(css, ".anime-pill", "border-radius")).toBe("50px");
    expect(ruleDeclaration(css, ".anime-pill", "font-weight")).toBe("900");
    expect(ruleDeclaration(css, ".anime-pill", "white-space")).toBe("nowrap");
    expect(ruleDeclaration(css, ".anime-pill", "font-size")).toBe("11.5px");
  });

  it("paints the canvas count pill in the explore teal pair", () => {
    expect(ruleDeclaration(css, ".anime-pill--teal", "background")).toBe("var(--color-explore-bg)");
    expect(ruleDeclaration(css, ".anime-pill--teal", "color")).toBe("var(--color-explore-fg)");
  });

  it("puts the gold rank on the SOFT gold tint, the only ground its ink survives", () => {
    expect(ruleDeclaration(css, ".anime-pill--gold", "background")).toBe("var(--color-gold-soft)");
    expect(ruleDeclaration(css, ".anime-pill--gold", "color")).toBe("var(--color-gold-fg)");
  });

  it("gives the plain pill the panel cream inside the content line", () => {
    expect(ruleDeclaration(css, ".anime-pill--plain", "background")).toBe("var(--color-card)");
    expect(ruleDeclaration(css, ".anime-pill--plain", "border")).toBe("1px solid var(--color-border-soft)");
  });
});

describe("§4.5 dividers", () => {
  it("separates area rows with the dashed list line and drops it after the last", () => {
    expect(ruleDeclaration(css, ".anime-area", "border-bottom")).toBe("1px dashed var(--color-border-soft)");
    expect(ruleDeclaration(css, ".anime-area:last-child", "border-bottom")).toBe("none");
  });
});

describe("§4.6 motion", () => {
  it("breathes the pending skeleton instead of leaving three dead blocks", () => {
    expect(ruleDeclaration(css, ".anime-skeleton", "animation"))
      .toBe("anime-skeleton-breathe 1.6s ease-in-out infinite");
    expect(ruleDeclaration(css, ".anime-skeleton", "border-radius")).toBe("18px");
  });

  it("stills the page for prefers-reduced-motion without hiding the cards", () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\S\s]*)\}/u.exec(css)?.[1] ?? "";
    expect(block).toContain(".anime-card");
    expect(block).toContain(".anime-skeleton");
    expect(block).toContain("animation: none");
    expect(block).toContain("transition: none");
  });
});

describe("error state layout", () => {
  it("pulls the 100vh rows together instead of letting them stretch apart", () => {
    expect(ruleDeclaration(css, ".anime-error", "align-content")).toBe("center");
    expect(ruleDeclaration(css, ".anime-error", "gap")).toBe("18px");
  });

  it("keeps both recovery actions on one centred row", () => {
    expect(ruleDeclaration(css, ".anime-actions", "justify-content")).toBe("center");
    expect(ruleDeclaration(css, ".anime-actions", "gap")).toBe("12px");
  });
});

describe("hero scale", () => {
  it("keeps the guide title at the canvas's 26px, not the landing display size", () => {
    expect(ruleDeclaration(css, ".anime-hero__title", "font-size")).toBe("26px");
    expect(ruleDeclaration(css, ".anime-hero__title", "font-family")).toBe("var(--app-font-display)");
  });
});
