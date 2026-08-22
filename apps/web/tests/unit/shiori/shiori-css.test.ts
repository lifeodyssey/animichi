import { describe, expect, it } from "vitest";
import css from "../../../src/styles/shiori.css?raw";
import photosCss from "../../../src/styles/shiori-photos.css?raw";
import generatorCss from "../../../src/styles/shiori-generator.css?raw";
import { lastRuleDeclaration, parseBlockTokens, ruleDeclaration, tokenValue } from "../stylesheet-probe";

/** The しおり skin against the design-sync canvas and its six visual languages. */
describe("§4.1 card language", () => {
  it("keeps only the poster's own 9:16 geometry, the plane being shared", () => {
    expect(ruleDeclaration(css, ".shiori-card", "aspect-ratio")).toBe("9 / 16");
    expect(ruleDeclaration(css, ".shiori-card", "border")).toBeNull();
    expect(ruleDeclaration(css, ".shiori-card", "background")).toBeNull();
    expect(css).not.toContain("@keyframes shiori-card-pop");
  });

  it("never reaches for the control press step as a resting card shadow", () => {
    // --shadow-press is the press step for controls.
    expect(css).not.toContain("--shadow-press");
  });
});

describe("§4.3 pill labels", () => {
  it("keeps the window pill round and heavy", () => {
    expect(ruleDeclaration(css, ".shiori-window", "border-radius")).toBe("50px");
    expect(ruleDeclaration(css, ".shiori-window", "font-weight")).toBe("900");
    expect(ruleDeclaration(generatorCss, ".shiori-generator__completion", "border-radius")).toBe("50px");
  });

  it("cuts both pills to the ONE §4.3 geometry, not a per-surface guess", () => {
    expect(ruleDeclaration(css, ".shiori-window", "padding")).toBe("3px 10px");
    expect(ruleDeclaration(generatorCss, ".shiori-generator__completion", "padding")).toBe("3px 10px");
    expect(ruleDeclaration(generatorCss, ".shiori-generator__completion", "font-size")).toBe("11.5px");
  });

  it("stamps the seal in SOLID gold on the shared ink and the shared deep step", () => {
    expect(ruleDeclaration(css, ".shiori-badge", "background")).toBe("var(--color-gold)");
    expect(ruleDeclaration(css, ".shiori-badge", "color")).toBe("var(--color-gold-ink)");
    expect(ruleDeclaration(css, ".shiori-badge", "box-shadow")).toBe("0 3px 0 0 var(--color-gold-deep)");
  });

  it("keeps no feature-local copy of the gold ink or the gold ledge", () => {
    expect(css).not.toContain("--shiori-gold");
  });
});

describe("canvas photo surfaces", () => {
  it("keeps the tile caption in one horizontal bar", () => {
    expect(ruleDeclaration(photosCss, ".shiori-tile__caption", "display")).toBe("flex");
    expect(ruleDeclaration(photosCss, ".shiori-tile__caption", "flex-direction")).not.toBe("column");
    expect(ruleDeclaration(photosCss, ".shiori-tile__caption", "gap")).toBe("6px");
    expect(ruleDeclaration(photosCss, ".shiori-tile__caption", "align-items")).toBe("baseline");
    expect(ruleDeclaration(photosCss, ".shiori-tile__caption", "justify-content")).toBe("space-between");
    expect(ruleDeclaration(photosCss, ".shiori-tile__caption", "padding")).toBe("4px 8px");
  });

  it("uses the stacked 8:9 composite frame instead of a cropped 4:3 photo", () => {
    expect(ruleDeclaration(photosCss, ".shiori-tile img", "aspect-ratio")).toBe("8 / 9");
  });

  it("puts the hero caption below the composite on the cream bar", () => {
    expect(ruleDeclaration(photosCss, ".shiori-hero", "display")).toBe("flex");
    expect(ruleDeclaration(photosCss, ".shiori-hero", "flex-direction")).toBe("column");
    expect(ruleDeclaration(photosCss, ".shiori-hero", "background")).not.toBe("var(--color-muted)");
    expect(ruleDeclaration(photosCss, ".shiori-hero__caption", "background")).toBe("var(--color-card)");
    expect(ruleDeclaration(photosCss, ".shiori-hero__caption", "color")).toBe("var(--color-fg)");
    expect(ruleDeclaration(photosCss, ".shiori-hero__caption", "padding")).toBe("5px 8px");
    expect(ruleDeclaration(photosCss, ".shiori-hero__counter", "position")).toBeNull();
  });

  it("restores the second-photo thumbnail column", () => {
    expect(ruleDeclaration(photosCss, ".shiori-second", "display")).toBe("grid");
    expect(ruleDeclaration(photosCss, ".shiori-second", "grid-template-columns")).toBe("72px minmax(0, 1fr)");
  });
});

describe("heading language", () => {
  it("keeps the eyebrow compact and visibly tracked", () => {
    // lastRuleDeclaration, not ruleDeclaration: the poster override
    // `.shiori-card--poster-fallback .shiori-head__eyebrow` is declared first and
    // would be matched by a plain substring search.
    expect(lastRuleDeclaration(css, ".shiori-head__eyebrow", "font-size")).toBe("0.625rem");
    expect(lastRuleDeclaration(css, ".shiori-head__eyebrow", "letter-spacing")).toBe("0.2em");
  });
});

describe("§4.5 dividers", () => {
  it("separates each stop row with the soft dashed line", () => {
    // Both row kinds share one rule, so the group's own selector is the anchor.
    const group = ".shiori-stop,\n.shiori-poster-stop";
    expect(ruleDeclaration(css, group, "border-bottom")).toBe("1px dashed var(--color-border-soft)");
  });

  it("keeps the poster check in its third grid column", () => {
    // The ticket row has two columns; only the poster row carries the ✓.
    expect(lastRuleDeclaration(css, ".shiori-stop", "grid-template-columns"))
      .toBe("3rem minmax(0, 1fr)");
    expect(lastRuleDeclaration(css, ".shiori-poster-stop", "grid-template-columns"))
      .toBe("3rem minmax(0, 1fr) auto");
  });

  it("draws the ticket perforation with the loud control-grade line", () => {
    expect(ruleDeclaration(css, ".shiori-card--ticket .shiori-head::before", "border-top"))
      .toBe("2px dashed var(--color-border)");
  });
});

describe("§4.6 motion", () => {
  it("stills the card for prefers-reduced-motion", () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}/u.exec(css)?.[1] ?? "";
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(block).toContain(".shiori-card");
    expect(block).toContain("animation: none");
  });
});

describe("export invariance", () => {
  it("keeps the saved artifact on local ground and ink tokens", () => {
    const local = parseBlockTokens(css, ".shiori-card");
    for (const name of ["--shiori-export-ground", "--shiori-export-ink"]) {
      expect(tokenValue(local, name)).toBeDefined();
    }

    const ground = ruleDeclaration(css, ".shiori-card--poster-fallback", "background");
    const ink = ruleDeclaration(css, ".shiori-card--poster-fallback", "color");
    // The しおり is saved as an image, so its ground must not follow the viewer's theme.
    expect(ground).toContain("var(--shiori-export-ground)");
    expect(ink).toContain("var(--shiori-export-ink)");
    expect(ground).not.toContain("--color-fg");
    expect(ground).not.toContain("--color-paper");
    expect(ink).not.toContain("--color-fg");
    expect(ink).not.toContain("--color-paper");
  });
});

describe("control edges", () => {
  it("keeps the empty state on the loud control border", () => {
    const border = ruleDeclaration(css, ".shiori-empty", "border");
    expect(border).toContain("var(--color-border)");
    expect(border).not.toContain("var(--color-border-soft)");
  });

  it("does not add a second border to the native EXIF checkbox", () => {
    expect(ruleDeclaration(generatorCss, ".shiori-generator__exif input", "border")).toBeNull();
  });
});

describe("palette hygiene", () => {
  it("does not borrow the focus ring in any shiori sheet", () => {
    expect(`${css}\n${photosCss}\n${generatorCss}`).not.toContain("--color-focus");
  });
});
