/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../msw/node";
import { popularEmptyHandler } from "../../msw/popular";
import { usersSavedRoutesEmptyHandler } from "../../msw/users";
import { setLanguages } from "../_i18n";
import { renderHome } from "./_render";
import { MOBILE_SPLASH_DWELL_MS } from "../../../src/features/splash/mobile-splash-handoff";
import { isIndexMatch } from "../../../src/routes/__root";

const navigate = vi.fn();
vi.mock("../../../src/lib/auth/session", () => ({ useAuthStatus: () => "anonymous" }));
vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));

const { HomeView } = await import("../../../src/routes/index");

beforeEach(() => {
  vi.useFakeTimers();
  navigate.mockClear();
  setLanguages(["ja-JP"]);
  server.use(popularEmptyHandler, usersSavedRoutesEmptyHandler);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("mobile splash hand-off to chat", () => {
  it("replaces / with /chat after the dwell on a mobile viewport", () => {
    window.innerWidth = 375;
    renderHome(<HomeView />);
    expect(navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MOBILE_SPLASH_DWELL_MS);
    expect(navigate).toHaveBeenCalledWith({ to: "/chat", replace: true });
  });

  it("stays on the landing on a desktop viewport", () => {
    window.innerWidth = 1280;
    renderHome(<HomeView />);
    vi.advanceTimersByTime(MOBILE_SPLASH_DWELL_MS * 4);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("lets a tap skip the dwell and never fires the hand-off twice", () => {
    window.innerWidth = 375;
    renderHome(<HomeView />);
    fireEvent.pointerDown(window);
    expect(navigate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(MOBILE_SPLASH_DWELL_MS * 2);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("lets a key press skip the dwell", () => {
    window.innerWidth = 375;
    renderHome(<HomeView />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith({ to: "/chat", replace: true });
  });
});

describe("splash dwell wiring", () => {
  it("marks the index route only", () => {
    expect(isIndexMatch([{ routeId: "__root__" }, { routeId: "/" }])).toBe(true);
    expect(isIndexMatch([{ routeId: "__root__" }, { routeId: "/chat" }])).toBe(false);
    expect(isIndexMatch([])).toBe(false);
  });

  it("holds the mobile splash past the hand-off so the landing never flashes", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/globals.css"), "utf8");
    const held = /\.app-splash\[data-splash-dwell="mobile"\]\s*\{\s*animation-delay:\s*(\d+)ms/.exec(css)?.[1];
    expect(Number(held)).toBeGreaterThan(MOBILE_SPLASH_DWELL_MS);
  });
});
