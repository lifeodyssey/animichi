/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Splash } from "../../src/components/Splash";

const componentSource = readFileSync(
  resolve(process.cwd(), "src/components/Splash.tsx"),
  "utf8",
);
const styleSource = readFileSync(
  resolve(process.cwd(), "src/styles/globals.css"),
  "utf8",
);

describe("static splash", () => {
  it("renders the brand lockup, title, and tagline on the static splash", () => {
    const { container } = render(<Splash />);
    expect(container.querySelector('[data-splash="static"]')).toBeTruthy();
    expect(container.textContent).toContain("Animichi");
    expect(container.textContent).toContain("聖地巡礼");
    expect(container.textContent).toContain("あの画面に、行こう。");
  });

  it("follows the stored theme and stays day by default on a first visit", () => {
    // First visit no longer follows OS dark; the user prefers the light base.
    expect(styleSource).not.toMatch(/@media \(prefers-color-scheme: dark\)/);
    expect(styleSource).toContain("--leaf-tile-image");
    expect(styleSource).toMatch(/\.app-splash \{[^}]*background-image: var\(--leaf-tile-image\)/);
  });

  it("dismisses within the 800ms budget without a JavaScript timer", () => {
    const delay = /app-splash-dismiss \d+ms step-end (\d+)ms forwards/.exec(styleSource)?.[1];
    expect(Number(delay)).toBeGreaterThan(0);
    expect(Number(delay)).toBeLessThanOrEqual(400);
    expect(componentSource).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
  });

  /**
   * Regression guard for the boundary bug found on 2026-08-23: with a plain
   * from/to pair the hidden state exists only at the animation's last instant,
   * where Chrome's progress lands an epsilon below 1 and step-end picks `from`
   * instead — the splash then never lifts. The hidden keyframe must therefore
   * start before 100% and run to it.
   */
  it("asserts the hidden state over a range, not on the final instant", () => {
    const frames = /@keyframes app-splash-dismiss \{([^}]*\}[^}]*)\}/.exec(styleSource)?.[1] ?? "";
    expect(frames).toMatch(/\n\s*1%,\s*100% \{[^}]*visibility: hidden/);
    expect(frames).not.toMatch(/\bto \{/);
  });

  it("marks the held index splash and leaves every other route bare", () => {
    const { container } = render(<Splash hold />);
    expect(container.querySelector('[data-splash-hold="handoff"]')).toBeTruthy();
    const bare = render(<Splash />);
    expect(bare.container.querySelector("[data-splash-hold]")).toBeNull();
  });
});
