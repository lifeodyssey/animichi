import { describe, expect, it } from "vitest";
import animeCss from "../../src/styles/anime.css?raw";
import cardPlaneCss from "../../src/styles/card-plane.css?raw";
import chatCss from "../../src/styles/chat.css?raw";
import globalsCss from "../../src/styles/globals.css?raw";
import routeCss from "../../src/styles/route-detail.css?raw";
import shioriCss from "../../src/styles/shiori.css?raw";

const CARD_POP = /@keyframes card-pop \{([\s\S]*?)\n\}/u;

/** Every card family enters on ONE set of frames, declared once in globals. */
describe("shared cardPop keyframes", () => {
  it("declares the frames once, in globals.css", () => {
    const frames = CARD_POP.exec(globalsCss)?.[1] ?? "";
    expect(frames).toContain("opacity: 0");
    expect(frames).toContain("transform: translateY(10px) scale(0.985)");
    expect(frames).toContain("transform: none");
    expect([...globalsCss.matchAll(/@keyframes card-pop\b/gu)]).toHaveLength(1);
  });

  it("spends them once, from the shared card plane", () => {
    expect(cardPlaneCss).toContain("animation: card-pop 0.4s cubic-bezier(0.2, 0.8, 0.3, 1) both");
  });

  it.each([
    ["anime", animeCss],
    ["route-detail", routeCss],
    ["shiori", shioriCss],
    ["chat", chatCss],
  ])("leaves %s.css restating neither the frames nor the entry", (_name, css) => {
    expect(css).not.toContain("animation: card-pop");
    expect(css).not.toMatch(/@keyframes [\w-]*card-pop\b/u);
  });
});