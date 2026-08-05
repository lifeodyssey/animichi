/**
 * @vitest-environment jsdom
 */
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandingPage } from "../../src/components/landing/LandingPage";
import { renderWithLocale, setLanguages } from "./_i18n";

const { isShowcaseMock } = vi.hoisted(() => ({ isShowcaseMock: vi.fn() }));

vi.mock("../../src/features/config/showcase", () => ({ isShowcase: isShowcaseMock }));

beforeEach(() => {
  setLanguages(["ja-JP"]);
  isShowcaseMock.mockReset();
});

afterEach(cleanup);

describe("LandingPage showcase wiring", () => {
  it("opens the popup from the hero search CTA when showcase is on", () => {
    isShowcaseMock.mockReturnValue(true);
    renderWithLocale(<LandingPage />);
    act(() => { screen.getAllByRole("button", { name: "巡礼をはじめる" })[0]?.click(); });
    expect(screen.getByRole("dialog", { name: "ただいま準備中です" })).toBeTruthy();
    expect(screen.queryByLabelText("メールアドレス")).toBeNull();
  });

  it("opens the popup from an example chip when showcase is on", () => {
    isShowcaseMock.mockReturnValue(true);
    renderWithLocale(<LandingPage />);
    act(() => { screen.getByRole("button", { name: "響け！ユーフォニアム" }).click(); });
    expect(screen.getByRole("dialog", { name: "ただいま準備中です" })).toBeTruthy();
  });

  it("opens the popup from the header login button when showcase is on", () => {
    isShowcaseMock.mockReturnValue(true);
    renderWithLocale(<LandingPage />);
    act(() => { screen.getAllByRole("button", { name: "ログイン" })[0]?.click(); });
    expect(screen.getByRole("dialog", { name: "ただいま準備中です" })).toBeTruthy();
  });

  it("opens the popup from the mobile fox CTA when showcase is on", () => {
    isShowcaseMock.mockReturnValue(true);
    renderWithLocale(<LandingPage />);
    act(() => { screen.getAllByRole("button", { name: "巡礼をはじめる" })[1]?.click(); });
    expect(screen.getByRole("dialog", { name: "ただいま準備中です" })).toBeTruthy();
  });

  it("closes the popup from its close control", () => {
    isShowcaseMock.mockReturnValue(true);
    renderWithLocale(<LandingPage />);
    act(() => { screen.getAllByRole("button", { name: "ログイン" })[0]?.click(); });
    act(() => { screen.getByRole("button", { name: "とじる" }).click(); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

});

describe("LandingPage showcase-off passthrough", () => {
  it("opens the login modal from the hero CTA when showcase is off", () => {
    isShowcaseMock.mockReturnValue(false);
    renderWithLocale(<LandingPage />);
    act(() => { screen.getAllByRole("button", { name: "巡礼をはじめる" })[0]?.click(); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("メールアドレス")).toBeTruthy();
  });

  it("opens the login modal from the header login button when showcase is off", () => {
    isShowcaseMock.mockReturnValue(false);
    renderWithLocale(<LandingPage />);
    act(() => { screen.getAllByRole("button", { name: "ログイン" })[0]?.click(); });
    expect(screen.getByLabelText("メールアドレス")).toBeTruthy();
  });

  it("passes an example chip through to the login modal when showcase is off", () => {
    isShowcaseMock.mockReturnValue(false);
    renderWithLocale(<LandingPage />);
    act(() => { screen.getByRole("button", { name: "響け！ユーフォニアム" }).click(); });
    expect(screen.getByLabelText("メールアドレス")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "ただいま準備中です" })).toBeNull();
  });

  it("passes the mobile fox CTA through to the login modal when showcase is off", () => {
    isShowcaseMock.mockReturnValue(false);
    renderWithLocale(<LandingPage />);
    act(() => { screen.getAllByRole("button", { name: "巡礼をはじめる" })[1]?.click(); });
    expect(screen.getByLabelText("メールアドレス")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "ただいま準備中です" })).toBeNull();
  });
});
