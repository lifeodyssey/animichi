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
    const delay = /app-splash-dismiss 1ms step-end (\d+)ms forwards/.exec(styleSource)?.[1];
    expect(Number(delay)).toBeGreaterThan(0);
    expect(Number(delay)).toBeLessThanOrEqual(400);
    expect(componentSource).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
  });
});
