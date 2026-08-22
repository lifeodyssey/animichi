/**
 * @vitest-environment jsdom
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeroSceneCard } from "../../src/components/landing/HeroSceneCard";
import { renderWithLocale, setLanguages } from "./_i18n";

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(cleanup);

describe("HeroSceneCard", () => {
  it("renders the comparison slider inside the journal card", () => {
    renderWithLocale(<HeroSceneCard />);
    expect(screen.getByRole("slider", { name: "アニメと実写を比較するスライダー" })).toBeTruthy();
  });

  it("leans the decorative fox over the card corner", () => {
    renderWithLocale(<HeroSceneCard />);
    const fox = document.querySelector("img.scene-card__fox");
    expect(fox?.getAttribute("src")).toBe("/images/landing/fox/fox-lean.svg");
    expect(fox?.getAttribute("alt")).toBe("");
    expect(fox?.getAttribute("aria-hidden")).toBe("true");
  });
});
