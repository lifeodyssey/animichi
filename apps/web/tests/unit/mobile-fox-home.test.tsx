/**
 * @vitest-environment jsdom
 */
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileFoxHome } from "../../src/components/landing/MobileFoxHome";
import { renderWithLocale, setLanguages } from "./_i18n";

const noop = () => undefined;

beforeEach(() => {
  setLanguages(["ja-JP"]);
  window.localStorage.clear();
});
afterEach(cleanup);

describe("MobileFoxHome", () => {
  it("renders the shrine-approach background with a localized alt", () => {
    renderWithLocale(<MobileFoxHome onLogin={noop} onStart={noop} />);
    const bg = screen.getByRole("img", { name: "手描き風の鳥居と参道のイラスト" });
    expect(bg.getAttribute("src")).toBe("/images/landing/shrine-approach.webp");
  });

  it("renders the welcoming fox with a localized alt", () => {
    renderWithLocale(<MobileFoxHome onLogin={noop} onStart={noop} />);
    const fox = screen.getByRole("img", { name: "しおりカードを持って案内するキツネ" });
    expect(fox.getAttribute("src")).toBe("/images/landing/fox-welcome.webp");
  });

  it("shows the fox speech bubble", () => {
    renderWithLocale(<MobileFoxHome onLogin={noop} onStart={noop} />);
    expect(screen.getByText("こっち！")).toBeTruthy();
  });

  it("shows the serif title and lead copy", () => {
    renderWithLocale(<MobileFoxHome onLogin={noop} onStart={noop} />);
    expect(screen.getByRole("heading", { name: "聖地巡礼" })).toBeTruthy();
    expect(screen.getByText("好きな作品から、行ける場所へ。地図と写真で迷わず巡ろう。")).toBeTruthy();
  });

  it("fires onStart from the gold CTA", () => {
    const onStart = vi.fn();
    renderWithLocale(<MobileFoxHome onLogin={noop} onStart={onStart} />);
    screen.getByRole("button", { name: "巡礼をはじめる" }).click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("fires onLogin from the top-bar login pill", () => {
    const onLogin = vi.fn();
    renderWithLocale(<MobileFoxHome onLogin={onLogin} onStart={noop} />);
    screen.getByRole("button", { name: "ログイン" }).click();
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it("exposes a language switcher in the top bar", () => {
    renderWithLocale(<MobileFoxHome onLogin={noop} onStart={noop} />);
    expect(screen.getByRole("group", { name: "Language" })).toBeTruthy();
  });

  it("switches the title to Animichi when the English locale is picked", () => {
    renderWithLocale(<MobileFoxHome onLogin={noop} onStart={noop} />);
    expect(screen.getByRole("heading", { name: "聖地巡礼" })).toBeTruthy();
    act(() => { screen.getByRole("button", { name: "EN" }).click(); });
    expect(screen.getByRole("heading", { name: "Animichi" })).toBeTruthy();
  });
});

describe("MobileFoxHome i18n", () => {
  it("renders English copy when the browser locale is English", () => {
    setLanguages(["en-US"]);
    renderWithLocale(<MobileFoxHome onLogin={noop} onStart={noop} />);
    expect(screen.getByText("This way!")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start Exploring" })).toBeTruthy();
    expect(screen.queryByText("こっち！")).toBeNull();
  });

  it("renders Chinese copy when the browser locale is Chinese", () => {
    setLanguages(["zh-CN"]);
    renderWithLocale(<MobileFoxHome onLogin={noop} onStart={noop} />);
    expect(screen.getByText("这边！")).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始巡礼" })).toBeTruthy();
  });
});
