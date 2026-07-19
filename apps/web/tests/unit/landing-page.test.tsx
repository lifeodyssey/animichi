/**
 * @vitest-environment jsdom
 */
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LandingPage } from "../../src/components/landing/LandingPage";
import { renderWithLocale, setLanguages } from "./_i18n";

beforeEach(() => {
  setLanguages(["ja-JP"]);
  window.localStorage.clear();
});
afterEach(cleanup);

describe("LandingPage", () => {
  it("renders the journal eyebrow, serif headline, and search CTA", () => {
    renderWithLocale(<LandingPage />);
    expect(screen.getByText("アニメ旅行ジャーナル")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("アニメの場面を");
    expect(screen.getByRole("button", { name: "巡礼をはじめる" })).toBeTruthy();
  });

  it("opens the login modal from the search CTA", () => {
    renderWithLocale(<LandingPage />);
    act(() => { screen.getByRole("button", { name: "巡礼をはじめる" }).click(); });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("opens the login modal from the header login button", () => {
    renderWithLocale(<LandingPage />);
    act(() => { screen.getByRole("button", { name: "ログイン" }).click(); });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes the login modal from the modal close control", () => {
    renderWithLocale(<LandingPage />);
    act(() => { screen.getByRole("button", { name: "ログイン" }).click(); });
    act(() => { screen.getByRole("button", { name: "閉じる" }).click(); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("links the footer to the GitHub repository", () => {
    renderWithLocale(<LandingPage />);
    const link = screen.getByRole("link", { name: "GitHub" });
    expect(link.getAttribute("href")).toContain("github.com");
  });
});

describe("LandingPage i18n", () => {
  it("re-renders all copy in English with no ja fallback leaking", () => {
    renderWithLocale(<LandingPage />);
    act(() => { screen.getByRole("button", { name: "EN" }).click(); });
    expect(screen.getByRole("button", { name: "Start Exploring" })).toBeTruthy();
    expect(screen.getByText("Anime Travel Journal")).toBeTruthy();
    expect(screen.queryByText("巡礼をはじめる")).toBeNull();
    expect(screen.queryByText("アニメ旅行ジャーナル")).toBeNull();
  });
});
