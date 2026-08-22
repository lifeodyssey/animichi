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

  it("shows the anime frame and the real photo with localized alt text", () => {
    renderWithLocale(<ComparisonSlider />);
    const anime = screen.getByAltText("『秒速5センチメートル』桜舞う踏切のアニメカット");
    const real = screen.getByAltText("桜咲く実在の踏切の写真");
    expect(anime.getAttribute("src")).toBe("/images/landing/compare/anime.jpg");
    expect(real.getAttribute("src")).toBe("/images/landing/compare/real.jpg");
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
