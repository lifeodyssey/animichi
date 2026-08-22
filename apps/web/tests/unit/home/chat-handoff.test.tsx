/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../msw/node";
import { popularEmptyHandler } from "../../msw/popular";
import { usersSavedRoutesEmptyHandler } from "../../msw/users";
import { setLanguages } from "../_i18n";
import { renderHome } from "./_render";
import { isIndexMatch } from "../../../src/routes/__root";

const navigate = vi.fn();
vi.mock("../../../src/lib/auth/session", () => ({ useAuthStatus: () => "anonymous" }));
vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));

const { HomeView } = await import("../../../src/routes/index");

const CHAT_TARGET = { to: "/chat", replace: true };
const GLOBALS_CSS = readFileSync(resolve(process.cwd(), "src/styles/globals.css"), "utf8");
const HANDOFF_SOURCE = readFileSync(
  resolve(process.cwd(), "src/features/splash/chat-handoff.ts"),
  "utf8",
);
const HOLD_SELECTOR = '.app-splash[data-splash-hold="handoff"]';

function splashDismissDelayMs(): number {
  return Number(/app-splash-dismiss \d+ms step-end (\d+)ms forwards/.exec(GLOBALS_CSS)?.[1]);
}

function splashHoldDelayMs(): number {
  return Number(
    /\.app-splash\[data-splash-hold="handoff"\]\s*\{\s*animation-delay:\s*(\d+)ms/.exec(GLOBALS_CSS)?.[1],
  );
}

/** Body of the `@media` block that starts at `open`, by brace matching. */
function mediaBodyFrom(open: number): string {
  let depth = 0;
  for (let i = open; i < GLOBALS_CSS.length; i += 1) {
    depth += Number(GLOBALS_CSS[i] === "{") - Number(GLOBALS_CSS[i] === "}");
    if (depth === 0) return GLOBALS_CSS.slice(open, i);
  }
  return GLOBALS_CSS.slice(open);
}

/** Every `@media` body in the sheet that contains `selector`. */
function mediaScopedRulesFor(selector: string): readonly string[] {
  return [...GLOBALS_CSS.matchAll(/@media[^{]*\{/g)]
    .map((match) => mediaBodyFrom(match.index + match[0].length - 1))
    .filter((body) => body.includes(selector));
}

beforeEach(() => {
  vi.useFakeTimers();
  navigate.mockClear();
  setLanguages(["ja-JP"]);
  server.use(popularEmptyHandler, usersSavedRoutesEmptyHandler);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("index hand-off to chat", () => {
  it.each([320, 640, 641, 1280, 1600])("replaces / with /chat at %ipx", (width) => {
    window.innerWidth = width;
    renderHome(<HomeView />);
    expect(navigate).toHaveBeenCalledWith(CHAT_TARGET);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("does not schedule the hand-off behind any clock", () => {
    window.innerWidth = 1600;
    renderHome(<HomeView />);
    expect(vi.getTimerCount()).toBe(0);
    expect(HANDOFF_SOURCE).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
  });

  it("reads no viewport, so no width can opt out of the doorway", () => {
    expect(HANDOFF_SOURCE).not.toMatch(/matchMedia|innerWidth|max-width/);
  });
});

describe("splash hold wiring", () => {
  it("marks the index route only", () => {
    expect(isIndexMatch([{ routeId: "__root__" }, { routeId: "/" }])).toBe(true);
    expect(isIndexMatch([{ routeId: "__root__" }, { routeId: "/chat" }])).toBe(false);
    expect(isIndexMatch([])).toBe(false);
  });

  /**
   * The no-flash invariant, stated as a floor: the held splash outlasts the
   * plain dismissal by a wide margin, so nothing but chat's own release
   * (tests/unit/splash-release.test.tsx) can uncover `/` first.
   */
  it("holds the index splash strictly longer than the plain dismissal", () => {
    expect(splashDismissDelayMs()).toBeGreaterThan(0);
    expect(splashHoldDelayMs()).toBeGreaterThan(splashDismissDelayMs());
  });

  /**
   * Owner 2026-08-23: desktop hands off too, so a viewport-scoped hold would
   * leave the landing bare for the whole navigation above the breakpoint.
   */
  it("holds at every viewport: no media query may scope the hold or its release", () => {
    expect(GLOBALS_CSS).toContain(HOLD_SELECTOR);
    expect(mediaScopedRulesFor(HOLD_SELECTOR)).toEqual([]);
  });
});
