/**
 * @vitest-environment jsdom
 */
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocaleSwitcher } from "../../src/i18n/LocaleSwitcher";
import { renderWithLocale, setLanguages } from "./_i18n";

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(cleanup);

describe("LocaleSwitcher", () => {
  it("renders one button per locale with ja active by default", () => {
    renderWithLocale(<LocaleSwitcher />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "日本語" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("marks the chosen locale as pressed on click", () => {
    renderWithLocale(<LocaleSwitcher />);
    act(() => { screen.getByRole("button", { name: "中文" }).click(); });
    expect(screen.getByRole("button", { name: "中文" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "日本語" }).getAttribute("aria-pressed")).toBe("false");
  });
});
