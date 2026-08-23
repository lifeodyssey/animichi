/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  writeStoredLocale,
} from "../../../src/lib/i18n/locale-storage";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("locale storage adapter (the only localStorage owner for the UI language)", () => {
  it("reads nothing when the visitor never chose a language", () => {
    expect(readStoredLocale()).toBeNull();
  });

  it("reads back exactly the stored language", () => {
    writeStoredLocale("zh");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh");
    expect(readStoredLocale()).toBe("zh");
  });

  it("rejects a language we do not ship, never leaking it", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    expect(readStoredLocale()).toBeNull();
  });

  it("is SSR-safe: no window means no read and no write", () => {
    vi.stubGlobal("window", undefined);
    writeStoredLocale("en");
    expect(readStoredLocale()).toBeNull();
  });

  it("degrades to null when the storage method throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStoredLocale()).toBeNull();
  });

  it("swallows a failing write rather than breaking the switch", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => { writeStoredLocale("en"); }).not.toThrow();
  });

  it("treats a throwing window.localStorage accessor as no store at all", () => {
    const spy = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked accessor");
    });
    expect(readStoredLocale()).toBeNull();
    expect(() => { writeStoredLocale("en"); }).not.toThrow();
    spy.mockRestore();
  });
});
