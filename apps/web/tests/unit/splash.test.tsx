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
  it("renders both system-selectable frames and the optimized fox asset", () => {
    const { container } = render(<Splash />);
    expect(container.querySelector('[data-splash="static"]')).toBeTruthy();
    expect(container.querySelector(".phone.day")).toBeTruthy();
    expect(container.querySelector(".phone.night")).toBeTruthy();
    expect(container.querySelector('img[src="/splash-day.svg"]')).toBeTruthy();
    expect(container.querySelector('img[src="/splash-night.svg"]')).toBeTruthy();
    expect(container.querySelector('img[src="/images/splash/fox-stand.webp"]')).toBeTruthy();
  });

  it("uses the day fallback, follows system mode, and honors stored theme", () => {
    expect(styleSource).toMatch(/\.app-splash__frame\.night\s*\{\s*display: none/);
    expect(styleSource).toMatch(/@media \(prefers-color-scheme: dark\)/);
    expect(styleSource).toMatch(/\.app-splash__frame\.day\s*\{\s*display: none/);
    expect(styleSource).toContain('[data-theme="dark"] .app-splash__frame.day');
    expect(styleSource).toContain('[data-theme="light"] .app-splash__frame.day');
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
    expect(container.querySelector('[data-splash-hold="mobile"]')).toBeTruthy();
    const bare = render(<Splash />);
    expect(bare.container.querySelector("[data-splash-hold]")).toBeNull();
  });
});
