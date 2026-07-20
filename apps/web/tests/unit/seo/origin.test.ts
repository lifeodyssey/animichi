/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentLocation, seoOrigin } from "../../../src/features/seo/origin";

afterEach(() => vi.unstubAllGlobals());

describe("currentLocation", () => {
  it("returns the browser location when window is present", () => {
    expect(currentLocation()).toBe(window.location);
  });

  it("returns undefined off the browser", () => {
    vi.stubGlobal("window", undefined);
    expect(currentLocation()).toBeUndefined();
  });
});

describe("seoOrigin", () => {
  it("prefers an explicit location origin", () => {
    expect(seoOrigin({ origin: "https://animichi.example" })).toBe("https://animichi.example");
  });

  it("falls back to the ambient browser origin", () => {
    expect(seoOrigin()).toBe(window.location.origin);
  });
});
