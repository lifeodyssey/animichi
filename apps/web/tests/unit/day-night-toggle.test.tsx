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

describe("DayNightToggle", () => {
  it("defaults to the day theme and persists it", () => {
    renderWithLocale(<DayNightToggle />);
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(window.localStorage.getItem("animichi-theme")).toBe("day");
  });

  it("toggles to night, updating aria, storage, and the document theme", () => {
    renderWithLocale(<DayNightToggle />);
    act(() => { screen.getByRole("switch").click(); });
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(window.localStorage.getItem("animichi-theme")).toBe("night");
    expect(document.documentElement.dataset.theme).toBe("night");
  });

  it("toggles back to day on a second press", () => {
    renderWithLocale(<DayNightToggle />);
    act(() => { screen.getByRole("switch").click(); });
    act(() => { screen.getByRole("switch").click(); });
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(window.localStorage.getItem("animichi-theme")).toBe("day");
  });

  it("restores a stored night preference on mount", () => {
    window.localStorage.setItem("animichi-theme", "night");
    renderWithLocale(<DayNightToggle />);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("ignores an invalid stored value and stays on day", () => {
    window.localStorage.setItem("animichi-theme", "sepia");
    renderWithLocale(<DayNightToggle />);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });
});
