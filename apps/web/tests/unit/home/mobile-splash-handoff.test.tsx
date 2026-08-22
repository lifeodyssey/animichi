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
import { MOBILE_SPLASH_BREAKPOINT_PX } from "../../../src/features/splash/mobile-splash-handoff";
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
  resolve(process.cwd(), "src/features/splash/mobile-splash-handoff.ts"),
  "utf8",
);

function splashDismissDelayMs(): number {
  return Number(/app-splash-dismiss \d+ms step-end (\d+)ms forwards/.exec(GLOBALS_CSS)?.[1]);
}

function splashHoldDelayMs(): number {
  return Number(
    /\.app-splash\[data-splash-hold="mobile"\]\s*\{\s*animation-delay:\s*(\d+)ms/.exec(GLOBALS_CSS)?.[1],
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  navigate.mockClear();
  setLanguages(["ja-JP"]);
  server.use(popularEmptyHandler, usersSavedRoutesEmptyHandler);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("mobile splash hand-off to chat", () => {
  it("replaces / with /chat on the first client effect, with no timer to wait out", () => {
    window.innerWidth = 375;
    renderHome(<HomeView />);
    expect(navigate).toHaveBeenCalledWith(CHAT_TARGET);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("does not schedule the hand-off behind any clock", () => {
    window.innerWidth = 375;
    renderHome(<HomeView />);
    expect(vi.getTimerCount()).toBe(0);
    expect(HANDOFF_SOURCE).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
  });

  it("stays on the landing on a desktop viewport", () => {
    window.innerWidth = 1280;
    renderHome(<HomeView />);
    vi.advanceTimersByTime(10_000);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("stays on the landing one pixel above the mobile breakpoint", () => {
    window.innerWidth = MOBILE_SPLASH_BREAKPOINT_PX + 1;
    renderHome(<HomeView />);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("hands off exactly at the mobile breakpoint", () => {
    window.innerWidth = MOBILE_SPLASH_BREAKPOINT_PX;
    renderHome(<HomeView />);
    expect(navigate).toHaveBeenCalledWith(CHAT_TARGET);
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
  it("holds the mobile index splash strictly longer than the plain dismissal", () => {
    expect(splashDismissDelayMs()).toBeGreaterThan(0);
    expect(splashHoldDelayMs()).toBeGreaterThan(splashDismissDelayMs());
  });

  it("scopes the hold to the same breakpoint the hand-off reads", () => {
    const scoped = new RegExp(
      `@media \\(max-width: ${String(MOBILE_SPLASH_BREAKPOINT_PX)}px\\) \\{\\s*\\[data-splash-scripting\\] \\.app-splash\\[data-splash-hold="mobile"\\]`,
    );
    expect(GLOBALS_CSS).toMatch(scoped);
  });
});
