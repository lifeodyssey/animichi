/**
 * FoxGuide unit tests — Task A5
 *
 * AC coverage:
 * - Happy: pose="welcome" renders fox-a-city-guide.png; each pose maps to correct asset -> unit
 * - Boundary: fox is aria-hidden (not announced); prefers-reduced-motion disables idle animation -> unit
 * - Error: unknown pose returns null at runtime -> unit
 * - Type policy: only valid FoxSurface values accepted (verified by tsc, not at runtime)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import FoxGuide from "@/components/generative/FoxGuide";
import type { FoxPose, FoxSurface } from "@/components/generative/FoxGuide";

// jsdom does not implement window.matchMedia — provide a default stub that
// reports motion allowed (matches = false for the reduce query).
function stubMatchMedia(reducedMotion: boolean) {
  window.matchMedia = (query: string) => ({
    matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeEach(() => stubMatchMedia(false));

// ---------------------------------------------------------------------------
// Happy path — pose-to-asset mapping
// (<img alt=""> has role=presentation, not img — query via container.querySelector)
// ---------------------------------------------------------------------------

describe("FoxGuide — pose asset mapping", () => {
  it("renders img with src containing fox-a-city-guide when pose is welcome", () => {
    const { container } = render(<FoxGuide pose="welcome" size="md" surface="welcome" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toContain("fox-a-city-guide");
  });

  it("renders img with src containing fox-c-ai-navigator when pose is ai-navigator", () => {
    const { container } = render(<FoxGuide pose="ai-navigator" size="md" surface="loading" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toContain("fox-c-ai-navigator");
  });

  it("renders img with src containing fox-e-scene-compare when pose is compare", () => {
    const { container } = render(<FoxGuide pose="compare" size="md" surface="welcome" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toContain("fox-e-scene-compare");
  });

  it("renders img with src containing fox-d-backpack-traveler when pose is traveler", () => {
    const { container } = render(<FoxGuide pose="traveler" size="md" surface="empty" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toContain("fox-d-backpack-traveler");
  });

  it("renders img with src containing fox-f-icon-mark when pose is icon-mark", () => {
    const { container } = render(<FoxGuide pose="icon-mark" size="sm" surface="welcome" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toContain("fox-f-icon-mark");
  });
});

// ---------------------------------------------------------------------------
// Boundary — accessibility + reduced motion
// ---------------------------------------------------------------------------

describe("FoxGuide — accessibility", () => {
  it("has aria-hidden=true so screen readers skip it", () => {
    const { container } = render(
      <FoxGuide pose="welcome" size="md" surface="welcome" />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute("aria-hidden")).toBe("true");
  });

  it("img element has empty alt text (decorative)", () => {
    const { container } = render(<FoxGuide pose="welcome" size="md" surface="welcome" />);
    const img = container.querySelector("img");
    // decorative: alt="" so screen readers skip it
    expect(img?.getAttribute("alt")).toBe("");
  });
});

describe("FoxGuide — prefers-reduced-motion", () => {
  it("applies no-animation class when prefers-reduced-motion: reduce", () => {
    stubMatchMedia(true);
    const { container } = render(
      <FoxGuide pose="welcome" size="md" surface="welcome" />,
    );
    const root = container.firstChild as HTMLElement;
    // When reduced motion is requested the idle animation class must NOT be present
    expect(root.className).not.toContain("fox-idle");
  });

  it("applies idle animation class when motion is allowed", () => {
    stubMatchMedia(false);
    const { container } = render(
      <FoxGuide pose="welcome" size="md" surface="welcome" />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("fox-idle");
  });
});

// ---------------------------------------------------------------------------
// Error path — unknown pose returns null
// ---------------------------------------------------------------------------

describe("FoxGuide — unknown pose guard", () => {
  it("returns null for an unknown pose string at runtime", () => {
    // Cast to bypass type check (simulating a mis-wired runtime value)
    const { container } = render(
      <FoxGuide
        pose={"unknown-pose" as FoxPose}
        size="md"
        surface="welcome"
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Type policy — FoxSurface whitelist (compile-time, verified via tsc)
// The following block confirms the *allowed* types work (not the disallowed ones,
// which are intentionally absent from the union and rejected by tsc).
// ---------------------------------------------------------------------------

describe("FoxGuide — FoxSurface type whitelist", () => {
  it("accepts surface='welcome'", () => {
    const surface: FoxSurface = "welcome";
    expect(() =>
      render(<FoxGuide pose="welcome" size="md" surface={surface} />),
    ).not.toThrow();
  });

  it("accepts surface='empty'", () => {
    const surface: FoxSurface = "empty";
    expect(() =>
      render(<FoxGuide pose="traveler" size="md" surface={surface} />),
    ).not.toThrow();
  });

  it("accepts surface='error'", () => {
    const surface: FoxSurface = "error";
    expect(() =>
      render(<FoxGuide pose="traveler" size="md" surface={surface} />),
    ).not.toThrow();
  });

  it("accepts surface='permission'", () => {
    const surface: FoxSurface = "permission";
    expect(() =>
      render(<FoxGuide pose="welcome" size="md" surface={surface} />),
    ).not.toThrow();
  });

  it("accepts surface='loading'", () => {
    const surface: FoxSurface = "loading";
    expect(() =>
      render(<FoxGuide pose="ai-navigator" size="md" surface={surface} />),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Size variants
// ---------------------------------------------------------------------------

describe("FoxGuide — size variants", () => {
  it.each([
    ["sm" as const],
    ["md" as const],
    ["lg" as const],
  ])("renders without error for size=%s", (size) => {
    expect(() =>
      render(<FoxGuide pose="welcome" size={size} surface="welcome" />),
    ).not.toThrow();
  });
});
