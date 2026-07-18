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
  it("renders the hero eyebrow, title, and Start CTA", () => {
    renderWithLocale(<LandingPage />);
    expect(screen.getByText("アニメ聖地巡礼")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("聖地巡礼");
    expect(screen.getByRole("button", { name: "はじめる" })).toBeTruthy();
  });

  it("opens the login modal from the hero CTA", () => {
    renderWithLocale(<LandingPage />);
    act(() => { screen.getByRole("button", { name: "はじめる" }).click(); });
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
});

describe("LandingPage i18n", () => {
  it("re-renders all copy in English with no ja fallback leaking", () => {
    renderWithLocale(<LandingPage />);
    act(() => { screen.getByRole("button", { name: "EN" }).click(); });
    expect(screen.getByRole("button", { name: "Start Exploring" })).toBeTruthy();
    expect(screen.getByText("Anime Pilgrimage")).toBeTruthy();
    expect(screen.queryByText("はじめる")).toBeNull();
    expect(screen.queryByText("アニメ聖地巡礼")).toBeNull();
  });
});
