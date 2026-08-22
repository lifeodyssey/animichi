import { describe, expect, it } from "vitest";
import css from "../../../src/styles/route-detail.css?raw";
import { MODE_EASING, MODE_TRANSITION_MS } from "../../../src/features/route-detail/lib/mode";
import { TEXT_COLOR, parseBlockTokens, ruleDeclaration, tokenValue } from "../stylesheet-probe";

/**
 * The route-detail skin against the design-sync canvas ("路线详情 状态总览.html")
 * and the six shared visual languages (chat-visual-restore/task.md §4).
 */
describe("§4.1 card language", () => {
  it("inherits the plane from card-plane.css rather than restating it", () => {
    expect(css).not.toContain("\n.route-card {");
    expect(css).not.toContain("@keyframes route-card-pop");
  });
});

describe("§4.2 3D press button", () => {
  it("keeps its own operable line and leaves the depth to press-3d.css", () => {
    expect(ruleDeclaration(css, ".route-press", "border")).toBe("2px solid var(--color-border)");
    expect(ruleDeclaration(css, ".route-press", "box-shadow")).toBeNull();
    expect(css).not.toContain(".route-press:hover");
    expect(css).not.toContain(".route-press:active");
  });
});

describe("§4.3 pill labels", () => {
  it("keeps pills round, heavy and unbreakable", () => {
    expect(ruleDeclaration(css, ".route-pill", "border-radius")).toBe("50px");
    expect(ruleDeclaration(css, ".route-pill", "font-weight")).toBe("900");
    expect(ruleDeclaration(css, ".route-pill", "white-space")).toBe("nowrap");
    expect(ruleDeclaration(css, ".route-pill", "padding")).toBe("3px 10px");
    expect(ruleDeclaration(css, ".route-pill", "font-size")).toBe("11.5px");
  });

  it("labels the gold fact with the TINT, not a solid ground under a ledge", () => {
    expect(ruleDeclaration(css, ".route-pill--gold", "background")).toBe("var(--color-gold-soft)");
    expect(ruleDeclaration(css, ".route-pill--gold", "color")).toBe("var(--color-gold-fg)");
    expect(ruleDeclaration(css, ".route-pill--gold", "box-shadow")).toBeNull();
  });

  it("keeps no feature-local copy of the gold ink or the gold ledge", () => {
    expect(css).not.toContain("--route-gold-ink");
    expect(css).not.toContain("--route-gold-deep");
  });

  it("renders the today gold bar as a pressable soft-gold pill (spec §1)", () => {
    expect(ruleDeclaration(css, ".route-goldbar", "border")).toBe("2px solid var(--color-gold)");
    expect(ruleDeclaration(css, ".route-goldbar", "background")).toBe("var(--color-gold-soft)");
    // The press step itself is press-3d.css's (see press-3d-css.test.ts); this
    // sheet keeps only the gold ground, the gold line, and the gold ledge.
    expect(ruleDeclaration(css, ".route-goldbar", "--press-ledge")).toBe("var(--color-gold-deep)");
    expect(ruleDeclaration(css, ".route-goldbar", "box-shadow")).toBeNull();
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
    expect(ruleDeclaration(css, '.route-pin[data-state="current"]', TEXT_COLOR)).toBe("var(--color-gold-ink)");
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
