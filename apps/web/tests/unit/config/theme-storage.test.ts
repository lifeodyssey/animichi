/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readStoredTheme, writeStoredTheme } from "../../../src/features/config/lib/theme-storage";

const THEME_KEY = "animichi-theme";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("theme storage adapter (issue #1009: the only localStorage owner for the theme)", () => {
  it("reads nothing when no theme is stored", () => {
    expect(readStoredTheme()).toBeNull();
  });

  it("reads back exactly the stored day/night value", () => {
    writeStoredTheme("night");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("night");
    expect(readStoredTheme()).toBe("night");
  });

  it("rejects a stored garbage value as null, never leaking it", () => {
    window.localStorage.setItem(THEME_KEY, "neon");
    expect(readStoredTheme()).toBeNull();
  });

  it("is SSR-safe: no window means no read and no write", () => {
    vi.stubGlobal("window", undefined);
    writeStoredTheme("day");
    expect(readStoredTheme()).toBeNull();
  });

  it("degrades to null when the storage accessor itself throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStoredTheme()).toBeNull();
  });
});
