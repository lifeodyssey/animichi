import { describe, expect, it } from "vitest";
import css from "../../../src/styles/route-detail.css?raw";
import { MODE_EASING, MODE_TRANSITION_MS } from "../../../src/features/route-detail/lib/mode";
import { parseBlockTokens, ruleDeclaration, tokenValue } from "../stylesheet-probe";

/**
 * The route-detail skin against the design-sync canvas ("路线详情 状态总览.html")
 * and the six shared visual languages (chat-visual-restore/task.md §4).
 */
describe("§4.1 card language", () => {
  it("draws every card as 2px line, 18px radius, clipped paper", () => {
    expect(ruleDeclaration(css, ".route-card", "border")).toBe("2px solid var(--color-border-soft)");
    expect(ruleDeclaration(css, ".route-card", "border-radius")).toBe("18px");
    expect(ruleDeclaration(css, ".route-card", "background")).toBe("var(--color-paper)");
    expect(ruleDeclaration(css, ".route-card", "overflow")).toBe("hidden");
  });

  it("floats the card on the warm drop shadow instead of a hard edge", () => {
    expect(ruleDeclaration(css, ".route-card", "box-shadow")).toBe("0 14px 30px -20px rgb(90 60 32 / 40%)");
  });

  it("enters with cardPop on the shared curve", () => {
    expect(ruleDeclaration(css, ".route-card", "animation"))
      .toBe("route-card-pop 0.4s cubic-bezier(0.2, 0.8, 0.3, 1) both");
    expect(css).toContain("transform: translateY(10px) scale(0.985)");
  });
});

describe("§4.2 3D press button", () => {
  it("wears the pill shape on the cream 3D step", () => {
    expect(ruleDeclaration(css, ".route-press", "border-radius")).toBe("50px");
    expect(ruleDeclaration(css, ".route-press", "font-weight")).toBe("800");
    expect(ruleDeclaration(css, ".route-press", "box-shadow")).toBe("0 3px 0 0 var(--shadow-3d)");
  });

  it("sinks into its own shadow when pressed", () => {
    expect(ruleDeclaration(css, ".route-press:active", "transform")).toBe("translateY(2px)");
    expect(ruleDeclaration(css, ".route-press:active", "box-shadow")).toBe("0 1px 0 0 var(--shadow-3d)");
  });

  it("lifts and turns teal on hover", () => {
    expect(ruleDeclaration(css, ".route-press:hover", "transform")).toBe("translateY(-2px)");
    expect(ruleDeclaration(css, ".route-press:hover", "border-color")).toBe("var(--color-primary)");
  });
});

describe("§4.3 pill labels", () => {
  it("keeps pills round, heavy and unbreakable", () => {
    expect(ruleDeclaration(css, ".route-pill", "border-radius")).toBe("50px");
    expect(ruleDeclaration(css, ".route-pill", "font-weight")).toBe("900");
    expect(ruleDeclaration(css, ".route-pill", "white-space")).toBe("nowrap");
  });

  it("gives the gold family its own ink and deep step", () => {
    expect(ruleDeclaration(css, ".route-pill--gold", "background")).toBe("var(--color-gold)");
    expect(ruleDeclaration(css, ".route-pill--gold", "color")).toBe("var(--route-gold-ink)");
    expect(ruleDeclaration(css, ".route-pill--gold", "box-shadow")).toBe("0 2.5px 0 0 var(--route-gold-deep)");
  });

  it("renders the today gold bar as a pressable soft-gold pill (spec §1)", () => {
    expect(ruleDeclaration(css, ".route-goldbar", "border")).toBe("2px solid var(--color-gold)");
    expect(ruleDeclaration(css, ".route-goldbar", "background")).toBe("var(--color-gold-soft)");
    expect(ruleDeclaration(css, ".route-goldbar:active", "transform")).toBe("translateY(2px)");
  });
});

describe("§5 map pins are framed markers, not dots", () => {
  it("frames each pin in paper with a 13px corner and a 3D drop", () => {
    expect(ruleDeclaration(css, ".route-pin", "border")).toBe("2.5px solid var(--color-paper)");
    expect(ruleDeclaration(css, ".route-pin", "border-radius")).toBe("13px");
    expect(ruleDeclaration(css, ".route-pin", "box-shadow")).toBe("0 3px 0 rgb(122 95 61 / 32%)");
  });

  it("hangs a pointer tail under the frame", () => {
    expect(ruleDeclaration(css, ".route-pin::after", "border-top-color")).toBe("var(--color-paper)");
    expect(ruleDeclaration(css, ".route-pin::after", "bottom")).toBe("-9px");
  });

  it("rings the 現在 pin in gold and tints the 済 pin teal", () => {
    expect(ruleDeclaration(css, '.route-pin[data-state="current"]', "box-shadow"))
      .toBe("0 0 0 3px rgb(240 180 41 / 45%), 0 3px 0 rgb(122 95 61 / 32%)");
    expect(ruleDeclaration(css, '.route-pin[data-state="visited"]', "background")).toBe("var(--color-map-pin-teal)");
  });
});

describe("§4.5 dividers", () => {
  it("separates the map face from its operable foot with the 2px block line", () => {
    expect(ruleDeclaration(css, ".route-map__bar", "border-top")).toBe("2px solid var(--color-border-soft)");
  });
});

describe("§4.6 motion honours the FLIP budget and reduced motion", () => {
  it("publishes the spec §2 FLIP budget as the stage's transition", () => {
    const page = parseBlockTokens(css, ".route-detail");
    expect(tokenValue(page, "--route-mode-ms")).toBe(`${String(MODE_TRANSITION_MS)}ms`);
    expect(tokenValue(page, "--route-mode-ease")).toBe(MODE_EASING);
    expect(ruleDeclaration(css, ".route-map__stage", "transition"))
      .toBe("min-height var(--route-mode-ms) var(--route-mode-ease)");
  });

  it("stills the page for prefers-reduced-motion", () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\S\s]*)\}/u.exec(css)?.[1] ?? "";
    expect(block).toContain("animation: none");
    expect(block).toContain("transition: none");
    expect(block).toContain(".route-card");
  });
});

describe("map-expanded sheet (spec §2)", () => {
  it("lifts the timetable into a 24px-cornered sheet with a grab handle", () => {
    const sheet = '.route-sheet[data-mode="expanded"]';
    expect(ruleDeclaration(css, sheet, "border-radius")).toBe("24px 24px 0 0");
    expect(ruleDeclaration(css, sheet, "box-shadow")).toBe("0 -8px 28px rgb(122 95 61 / 20%)");
    expect(ruleDeclaration(css, `${sheet}::before`, "height")).toBe("5px");
  });
});
