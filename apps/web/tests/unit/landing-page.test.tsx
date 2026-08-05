/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandingPage } from "../../src/components/landing/LandingPage";
import { sendMagicLink } from "../../src/lib/auth/neonAuth";
import { renderWithLocale, setLanguages } from "./_i18n";

vi.mock("../../src/lib/auth/neonAuth", () => ({ sendMagicLink: vi.fn() }));
const send = vi.mocked(sendMagicLink);

beforeEach(() => {
  setLanguages(["ja-JP"]);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LandingPage", () => {
  it("renders the journal eyebrow, serif headline, and search CTA", () => {
    renderWithLocale(<LandingPage />);
    expect(screen.getByText("アニメ旅行ジャーナル")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("アニメの場面を");
    expect(screen.getAllByRole("button", { name: "巡礼をはじめる" }).length).toBe(2);
  });

  it("renders the mobile fox welcome section alongside the desktop hero", () => {
    renderWithLocale(<LandingPage />);
    expect(screen.getByRole("heading", { name: "聖地巡礼" })).toBeTruthy();
    expect(screen.getByText("こっち！")).toBeTruthy();
  });

  it("opens the login modal from the desktop search CTA", () => {
    renderWithLocale(<LandingPage />);
    act(() => { screen.getAllByRole("button", { name: "巡礼をはじめる" })[0]?.click(); });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("opens the login modal from the mobile fox CTA", () => {
    renderWithLocale(<LandingPage />);
    act(() => { screen.getAllByRole("button", { name: "巡礼をはじめる" })[1]?.click(); });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("opens the login modal from the header login button", () => {
    renderWithLocale(<LandingPage />);
    act(() => { screen.getAllByRole("button", { name: "ログイン" })[0]?.click(); });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes the login modal from the modal close control", () => {
    renderWithLocale(<LandingPage />);
    act(() => { screen.getAllByRole("button", { name: "ログイン" })[0]?.click(); });
    act(() => { screen.getByRole("button", { name: "閉じる" }).click(); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("links the footer to the GitHub repository", () => {
    renderWithLocale(<LandingPage />);
    const link = screen.getByRole("link", { name: "GitHub" });
    expect(link.getAttribute("href")).toContain("github.com");
  });

  it("exposes the localized privacy policy from the footer", () => {
    renderWithLocale(<LandingPage />);
    expect(screen.getByRole("link", { name: "プライバシーポリシー" }).getAttribute("href")).toBe("/privacy");
  });
});

describe("LandingPage i18n", () => {
  it("re-renders all copy in English with no ja fallback leaking", () => {
    renderWithLocale(<LandingPage />);
    act(() => { screen.getAllByRole("button", { name: "EN" })[0]?.click(); });
    expect(screen.getAllByRole("button", { name: "Start Exploring" }).length).toBe(2);
    expect(screen.getByText("Anime Travel Journal")).toBeTruthy();
    expect(screen.queryByText("巡礼をはじめる")).toBeNull();
    expect(screen.queryByText("アニメ旅行ジャーナル")).toBeNull();
  });
});

/** Journey §1-A②: landing search keeps the query so post-login lands on
 * `/chat?q=…` (A2 optimistic render, no retyping). */
describe("LandingPage hero query preservation", () => {
  function submitLoginFromModal(): void {
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "fan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }));
  }

  it("carries a submitted query through login as a /chat?q= return target", async () => {
    send.mockResolvedValue("sent");
    renderWithLocale(<LandingPage />);
    fireEvent.change(screen.getByRole("textbox", { name: "アニメ・駅・都市を入力" }), { target: { value: "君の名は。" } });
    act(() => { screen.getAllByRole("button", { name: "巡礼をはじめる" })[0]?.click(); });
    submitLoginFromModal();
    await waitFor(() => { expect(send).toHaveBeenCalled(); });
    const encodedTarget = encodeURIComponent(`/chat?q=${encodeURIComponent("君の名は。")}`);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      callbackURL: `${window.location.origin}/auth/callback?next=${encodedTarget}`,
    }));
  });

  it("sends no return target when the hero search is submitted empty", async () => {
    send.mockResolvedValue("sent");
    renderWithLocale(<LandingPage />);
    act(() => { screen.getAllByRole("button", { name: "巡礼をはじめる" })[0]?.click(); });
    submitLoginFromModal();
    await waitFor(() => { expect(send).toHaveBeenCalled(); });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      callbackURL: `${window.location.origin}/auth/callback`,
    }));
  });

  it("does not carry a stale query after the plain login button is used", async () => {
    send.mockResolvedValue("sent");
    renderWithLocale(<LandingPage />);
    fireEvent.change(screen.getByRole("textbox", { name: "アニメ・駅・都市を入力" }), { target: { value: "君の名は。" } });
    act(() => { screen.getAllByRole("button", { name: "巡礼をはじめる" })[0]?.click(); });
    act(() => { screen.getByRole("button", { name: "閉じる" }).click(); });
    act(() => { screen.getAllByRole("button", { name: "ログイン" })[0]?.click(); });
    submitLoginFromModal();
    await waitFor(() => { expect(send).toHaveBeenCalled(); });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      callbackURL: `${window.location.origin}/auth/callback`,
    }));
  });
});
