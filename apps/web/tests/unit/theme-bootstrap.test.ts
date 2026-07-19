/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { THEME_BOOTSTRAP_SCRIPT, THEME_STORAGE_KEY } from "../../src/components/theme-bootstrap";
import { Route } from "../../src/routes/__root";

/** Execute exactly what the served <head> executes: an inline script tag. */
function runBootstrap(): void {
  const script = document.createElement("script");
  script.textContent = THEME_BOOTSTRAP_SCRIPT;
  document.head.append(script);
  script.remove();
}

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("theme bootstrap script", () => {
  it("applies the stored night preference before hydration", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "night");
    runBootstrap();
    expect(document.documentElement.dataset.theme).toBe("night");
  });

  it("applies the stored day preference before hydration", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "day");
    runBootstrap();
    expect(document.documentElement.dataset.theme).toBe("day");
  });

  it("leaves the default theme untouched for a garbage stored value", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "neon");
    runBootstrap();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("leaves the default theme untouched when nothing is stored", () => {
    runBootstrap();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe("root route head", () => {
  it("ships the theme bootstrap as an inline script for every route", () => {
    const head = Route.options.head?.({} as never);
    const scripts = (head as { scripts?: readonly { children?: string }[] }).scripts ?? [];
    const inline = scripts.map((script) => script.children ?? "").join("\n");
    expect(inline).toContain(THEME_STORAGE_KEY);
  });
});
