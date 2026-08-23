import { describe, expect, it } from "vitest";
import chatCss from "../../../src/styles/chat.css?raw";
import globalsCss from "../../../src/styles/globals.css?raw";

/**
 * WCAG 2.2.2 Pause/Stop/Hide + 2.3.3 Animation from Interactions: decorative
 * motion must yield under prefers-reduced-motion. Stable unit gate; the
 * browser e2e (AC4) re-asserts it against the rendered page.
 */
const MOTION_MEDIA = "@media (prefers-reduced-motion: reduce)";

describe("reduced-motion: looping chat animations are paused", () => {
  const looping = [
    ".chat-typing__dot",
    '.chat-step[data-status="running"]',
    ".chat-card--skeleton",
  ] as const;

  it.each(looping)("%s is neutralised by the reduce guard", (selector) => {
    const media = chatCss.slice(chatCss.indexOf(MOTION_MEDIA));
    expect(media).toContain(MOTION_MEDIA);
    expect(media.indexOf(selector)).toBeGreaterThanOrEqual(0);
    expect(media).toContain("animation: none");
  });
});

describe("reduced-motion: the settings controls join the guard", () => {
  const moving = [".ds-switch__handle", ".ds-select__menu"] as const;

  it("globals.css contains the reduce media guard", () => {
    expect(globalsCss).toContain(MOTION_MEDIA);
  });

  it.each(moving)("%s is neutralised by the reduce guard", (selector) => {
    const media = globalsCss.slice(globalsCss.indexOf(MOTION_MEDIA));
    expect(media.indexOf(selector)).toBeGreaterThanOrEqual(0);
    expect(media).toMatch(/transition\s*:\s*none|animation\s*:\s*none/);
  });
});
