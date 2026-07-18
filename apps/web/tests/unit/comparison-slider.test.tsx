/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComparisonSlider } from "../../src/components/landing/ComparisonSlider";
import { renderWithLocale, setLanguages } from "./_i18n";

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(cleanup);

describe("ComparisonSlider", () => {
  it("labels both the anime and reality panes", () => {
    renderWithLocale(<ComparisonSlider />);
    expect(screen.getByText("アニメ")).toBeTruthy();
    expect(screen.getByText("現実")).toBeTruthy();
  });

  it("drives the reveal width from the range input", () => {
    renderWithLocale(<ComparisonSlider />);
    const range = screen.getByRole("slider");
    fireEvent.change(range, { target: { value: "80" } });
    expect((range as HTMLInputElement).value).toBe("80");
    const figure = range.closest(".comparison") as HTMLElement;
    expect(figure.style.getPropertyValue("--reveal")).toBe("80%");
  });
});
