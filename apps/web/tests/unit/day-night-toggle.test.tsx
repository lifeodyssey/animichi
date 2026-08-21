/**
 * @vitest-environment jsdom
 */
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DayNightToggle } from "../../src/components/landing/DayNightToggle";
import { renderWithLocale, setLanguages } from "./_i18n";

beforeEach(() => {
  setLanguages(["ja-JP"]);
  window.localStorage.clear();
});
afterEach(cleanup);

/** The single circular switch; its accessible name is the mode in force. */
function themeSwitch(): HTMLElement {
  return screen.getByRole("switch");
}

/** Which face the switch is currently showing, from the glyph's own marker. */
function shownGlyph(): string | null {
  return themeSwitch().querySelector("svg")?.getAttribute("data-glyph") ?? null;
}

describe("DayNightToggle", () => {
  it("defaults to the day mode, showing the sun and persisting day", () => {
    renderWithLocale(<DayNightToggle />);
    expect(themeSwitch().getAttribute("aria-checked")).toBe("false");
    expect(themeSwitch().getAttribute("aria-label")).toBe("昼");
    expect(shownGlyph()).toBe("sun");
    expect(window.localStorage.getItem("animichi-theme")).toBe("day");
  });

  it("switches to night on click, updating aria, glyph, storage, and the document theme", () => {
    renderWithLocale(<DayNightToggle />);
    act(() => { themeSwitch().click(); });
    expect(themeSwitch().getAttribute("aria-checked")).toBe("true");
    expect(themeSwitch().getAttribute("aria-label")).toBe("夜");
    expect(shownGlyph()).toBe("moon");
    expect(window.localStorage.getItem("animichi-theme")).toBe("night");
    expect(document.documentElement.dataset.theme).toBe("night");
  });

  it("switches back to day on a second click", () => {
    renderWithLocale(<DayNightToggle />);
    act(() => { themeSwitch().click(); });
    act(() => { themeSwitch().click(); });
    expect(themeSwitch().getAttribute("aria-checked")).toBe("false");
    expect(shownGlyph()).toBe("sun");
    expect(window.localStorage.getItem("animichi-theme")).toBe("day");
    expect(document.documentElement.dataset.theme).toBe("day");
  });

  it("restores a stored night preference on mount", () => {
    window.localStorage.setItem("animichi-theme", "night");
    renderWithLocale(<DayNightToggle />);
    expect(themeSwitch().getAttribute("aria-checked")).toBe("true");
    expect(shownGlyph()).toBe("moon");
  });

  it("ignores an invalid stored value and stays on day", () => {
    window.localStorage.setItem("animichi-theme", "sepia");
    renderWithLocale(<DayNightToggle />);
    expect(themeSwitch().getAttribute("aria-checked")).toBe("false");
    expect(shownGlyph()).toBe("sun");
  });
});
