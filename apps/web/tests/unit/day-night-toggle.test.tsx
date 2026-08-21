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

function dayButton(): HTMLElement {
  return screen.getByRole("button", { name: "昼" });
}

function nightButton(): HTMLElement {
  return screen.getByRole("button", { name: "夜" });
}

describe("DayNightToggle", () => {
  it("defaults to the day mode and persists it", () => {
    renderWithLocale(<DayNightToggle />);
    expect(dayButton().getAttribute("aria-pressed")).toBe("true");
    expect(nightButton().getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem("animichi-theme")).toBe("day");
  });

  it("switches to night from the night button, updating aria, storage, and the document theme", () => {
    renderWithLocale(<DayNightToggle />);
    act(() => { nightButton().click(); });
    expect(nightButton().getAttribute("aria-pressed")).toBe("true");
    expect(dayButton().getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem("animichi-theme")).toBe("night");
    expect(document.documentElement.dataset.theme).toBe("night");
  });

  it("switches back to day from the day button", () => {
    renderWithLocale(<DayNightToggle />);
    act(() => { nightButton().click(); });
    act(() => { dayButton().click(); });
    expect(dayButton().getAttribute("aria-pressed")).toBe("true");
    expect(nightButton().getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem("animichi-theme")).toBe("day");
  });

  it("restores a stored night preference on mount", () => {
    window.localStorage.setItem("animichi-theme", "night");
    renderWithLocale(<DayNightToggle />);
    expect(nightButton().getAttribute("aria-pressed")).toBe("true");
  });

  it("ignores an invalid stored value and stays on day", () => {
    window.localStorage.setItem("animichi-theme", "sepia");
    renderWithLocale(<DayNightToggle />);
    expect(dayButton().getAttribute("aria-pressed")).toBe("true");
  });
});
