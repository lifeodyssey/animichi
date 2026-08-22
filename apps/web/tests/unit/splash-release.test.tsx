/**
 * @vitest-environment jsdom
 *
 * The no-flash invariant, at the level it actually lives: the mobile index
 * splash is lifted by chat having painted, never by a clock running out.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SPLASH_RELEASE_ATTRIBUTE,
  SPLASH_SCRIPTING_ATTRIBUTE,
  SPLASH_SCRIPTING_MARK_SCRIPT,
  useSplashRelease,
} from "../../src/features/splash/splash-release";
import { rootHead } from "../../src/routes/__root";

const GLOBALS_CSS = readFileSync(resolve(process.cwd(), "src/styles/globals.css"), "utf8");
const RELEASE_SOURCE = readFileSync(
  resolve(process.cwd(), "src/features/splash/splash-release.ts"),
  "utf8",
);

const HOLD_RULE = `[${SPLASH_SCRIPTING_ATTRIBUTE}] .app-splash[data-splash-hold="mobile"]`;
const RELEASE_RULE = `[${SPLASH_RELEASE_ATTRIBUTE}] .app-splash[data-splash-hold="mobile"]`;

function delayAfter(rule: string): number {
  const at = GLOBALS_CSS.indexOf(rule);
  return Number(/animation-delay:\s*(\d+)ms/.exec(GLOBALS_CSS.slice(at))?.[1]);
}

function plainDismissDelayMs(): number {
  return Number(/app-splash-dismiss \d+ms step-end (\d+)ms forwards/.exec(GLOBALS_CSS)?.[1]);
}

function DestinationProbe() {
  useSplashRelease();
  return <main>chat</main>;
}

function scriptBodies(): readonly string[] {
  return rootHead().scripts.map((script) => ("children" in script ? script.children : ""));
}

describe("splash release signal", () => {
  it("marks the document while the destination is mounted and unmarks it after", () => {
    const view = render(<DestinationProbe />);
    expect(document.documentElement.hasAttribute(SPLASH_RELEASE_ATTRIBUTE)).toBe(true);
    view.unmount();
    expect(document.documentElement.hasAttribute(SPLASH_RELEASE_ATTRIBUTE)).toBe(false);
  });

  it("stamps nothing during a server render, so hydration has no mismatch", () => {
    expect(renderToString(<DestinationProbe />)).toContain("chat");
    expect(document.documentElement.hasAttribute(SPLASH_RELEASE_ATTRIBUTE)).toBe(false);
  });

  it("adds no second clock of its own", () => {
    expect(RELEASE_SOURCE).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
  });
});

describe("splash hold cascade", () => {
  it("only holds when a pre-paint script proved scripting is available", () => {
    expect(GLOBALS_CSS).toContain(HOLD_RULE);
    expect(SPLASH_SCRIPTING_MARK_SCRIPT).toContain(SPLASH_SCRIPTING_ATTRIBUTE);
    expect(scriptBodies()).toContain(SPLASH_SCRIPTING_MARK_SCRIPT);
  });

  it("lets the release win the cascade: same specificity, declared last", () => {
    expect(GLOBALS_CSS.indexOf(RELEASE_RULE)).toBeGreaterThan(GLOBALS_CSS.indexOf(HOLD_RULE));
    expect(delayAfter(RELEASE_RULE)).toBe(plainDismissDelayMs());
  });

  /**
   * The bail-out must never be the thing that ends the splash on a merely slow
   * client: chat painted at 15.7s/17.5s/17.6s on a throttled production build
   * (200kbps, CPU 1x/4x/8x), so any hold near those values re-opens the flash.
   */
  it("keeps the scripting bail-out beyond the slowest measured chat paint", () => {
    expect(delayAfter(HOLD_RULE)).toBeGreaterThanOrEqual(20_000);
  });
});
