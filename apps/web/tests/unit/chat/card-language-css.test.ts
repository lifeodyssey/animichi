import { describe, expect, it } from "vitest";
import chatCss from "../../../src/styles/chat.css?raw";
import globalsCss from "../../../src/styles/globals.css?raw";
import pressCss from "../../../src/styles/press-3d.css?raw";
import { contrastRatio, lastRuleDeclaration, parseBlockTokens, parseTokens, ruleDeclaration, tokenValue } from "../stylesheet-probe";

const day = parseTokens(globalsCss);
const night = parseBlockTokens(globalsCss, '[data-theme="night"]');

const PILL_FAMILY = [
  ".chat-card__version-badge",
  ".chat-pacing-pill",
  ".chat-route-pill",
].join(",\n");

/* These class names survive only as unstyled DOM hooks on the shared
 * InlineNotice/AnimalButton surfaces — the guarantee is that no stylesheet
 * ever hangs custom press chrome on them again. The render-level half (every
 * hook element really is an `animal-btn`) lives in chat-banner-css.test.tsx. */
const RETIRED_CHAT_PRESS_SELECTORS = [
  ".chat-error-banner__retry",
  ".chat-fallback__retry",
  ".chat-interruption__retry",
  ".chat-session-expired__login",
  ".chat-session-expired__resume",
  ".chat-budget-exhausted__login",
  ".chat-quota-exhausted__login",
  ".chat-byok-rejected__open",
];

describe("§4.1 card shell: one plane for every intent card", () => {
  it("keeps only its own padding, the plane coming from card-plane.css", () => {
    expect(ruleDeclaration(chatCss, ".chat-card", "padding")).toBe("0.875rem 1rem");
    expect(ruleDeclaration(chatCss, ".chat-card", "background")).toBeNull();
    expect(ruleDeclaration(chatCss, ".chat-card", "border-radius")).toBeNull();
  });

  it("drops the theme-flipping drop shadow this copy had drifted onto", () => {
    expect(ruleDeclaration(chatCss, ".chat-card", "box-shadow")).toBeNull();
    expect(chatCss).not.toContain("30px -20px");
  });

  it("floats the card above the page floor it sits on", () => {
    const paper = tokenValue(day, "--color-paper");
    const floor = tokenValue(day, "--color-bg");
    expect(contrastRatio(paper, floor)).toBeGreaterThan(1);
  });
});

describe("§4.6 cardPop: a card lands, and yields to the reduce preference", () => {
  it("leaves the entry to the shared plane and keeps no private copy of it", () => {
    expect(ruleDeclaration(chatCss, ".chat-card", "animation")).toBeNull();
    expect(chatCss).not.toContain("@keyframes chat-card-pop");
  });

  it("joins the existing reduced-motion list rather than starting a second one", () => {
    const blocks = [...chatCss.matchAll(/@media \(prefers-reduced-motion: reduce\) \{/gu)];
    expect(blocks).toHaveLength(1);
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}/u.exec(chatCss)?.[1] ?? "";
    expect(block).toContain(".chat-card,");
  });
});

describe("§4.3 pill label: one geometry, many grounds", () => {
  it("declares the pill shape once for the whole family", () => {
    expect(chatCss).toContain(`${PILL_FAMILY} {`);
    expect(ruleDeclaration(chatCss, PILL_FAMILY, "border-radius")).toBe("50px");
    expect(ruleDeclaration(chatCss, PILL_FAMILY, "padding")).toBe("3px 10px");
    expect(ruleDeclaration(chatCss, PILL_FAMILY, "font-size")).toBe("11.5px");
    expect(ruleDeclaration(chatCss, PILL_FAMILY, "font-weight")).toBe("900");
    expect(ruleDeclaration(chatCss, PILL_FAMILY, "white-space")).toBe("nowrap");
  });

  it.each([
    [".chat-card__version-badge", "var(--color-muted)", "var(--color-fg)"],
    [".chat-pacing-pill", "var(--color-muted)", "var(--color-fg)"],
    [".chat-route-pill", "var(--color-gold-soft)", "var(--color-gold-fg)"],
  ])("leaves %s carrying its own ink pair only — no second copy of the shape", (selector, ground, ink) => {
    expect(lastRuleDeclaration(chatCss, selector, "background")).toBe(ground);
    expect(lastRuleDeclaration(chatCss, selector, "color")).toBe(ink);
    expect(lastRuleDeclaration(chatCss, selector, "border-radius")).toBeNull();
    expect(lastRuleDeclaration(chatCss, selector, "font-size")).toBeNull();
  });
});

describe("§4.2 Animal Button press: no legacy selector overrides the library", () => {
  it.each(RETIRED_CHAT_PRESS_SELECTORS)("retires the custom %s press rules", (selector) => {
    expect(chatCss).not.toContain(selector);
    expect(pressCss).not.toContain(selector);
  });

  it("loads the Animal Island class layer before app chat styles", () => {
    const animalImport = globalsCss.indexOf('@import "animal-island-ui-tailwind/style/core";');
    const chatImport = globalsCss.indexOf('@import "./chat.css";');
    expect(animalImport).toBeGreaterThan(-1);
    expect(chatImport).toBeGreaterThan(animalImport);
  });
});

describe("§4.5 route list and block separators", () => {
  it("parts a whole block with the design's 2px solid line", () => {
    expect(ruleDeclaration(chatCss, ".chat-short-route", "border-top")).toBe("2px solid var(--color-border-soft)");
  });

  it("strips native list chrome from the numbered route timeline", () => {
    expect(ruleDeclaration(chatCss, ".chat-itinerary__timeline", "list-style")).toBe("none");
  });
});

describe("the paper ground keeps every ink inside a card above AA", () => {
  it.each([
    ["--color-fg"],
    ["--color-muted-fg"],
    ["--color-error-strong"],
    ["--color-primary-strong"],
  ])("reads %s on the day card plane at 4.5:1 or better", (ink) => {
    const ratio = contrastRatio(tokenValue(day, ink), tokenValue(day, "--color-paper"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the picked tile's own label above AA on its teal ground", () => {
    const ratio = contrastRatio(tokenValue(day, "--color-fg"), tokenValue(day, "--color-primary-soft"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the version badge above AA, which the muted ink pair was not", () => {
    const ratio = contrastRatio(tokenValue(day, "--color-fg"), tokenValue(day, "--color-muted"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokenValue(day, "--color-muted-fg"), tokenValue(day, "--color-muted"))).toBeLessThan(4.5);
  });

  it.each([["--color-fg"], ["--color-muted-fg"]])("reads %s on the night card plane too", (ink) => {
    const ratio = contrastRatio(tokenValue(night, ink), tokenValue(night, "--color-paper"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the quiet escape readable on its night hover ground", () => {
    const ratio = contrastRatio(tokenValue(night, "--color-muted-fg"), tokenValue(night, "--color-muted"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
