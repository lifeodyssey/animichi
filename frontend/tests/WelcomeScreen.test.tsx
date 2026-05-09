/**
 * AC: Empty state shows WelcomeScreen with logo, tagline, 3 quick-action chips, anime covers.
 * AC: After first message sent, WelcomeScreen replaced by message list.
 * AC: Quick-action chip tap fills input instead of sending.
 * AC: /v1/bangumi/popular returns empty — anime covers fallback, chips visible.
 * AC: /v1/bangumi/popular network failure — WelcomeScreen renders without crash.
 * AC: Welcome tagline and chip labels render in ja, zh, en.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./mocks/server";
import WelcomeScreen from "@/components/chat/WelcomeScreen";
import type { Dict, Locale } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import zhDict from "@/lib/dictionaries/zh.json";
import enDict from "@/lib/dictionaries/en.json";

const jaFull = jaDict as unknown as Dict;
const zhFull = zhDict as unknown as Dict;
const enFull = enDict as unknown as Dict;

function renderWelcomeScreen(
  onSend: (text: string) => void = vi.fn(),
  dict: Dict = jaFull,
  locale: Locale = "ja",
) {
  return render(
    <WelcomeScreen onSend={onSend} dict={dict} locale={locale} />,
  );
}

describe("WelcomeScreen", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the tagline as heading", () => {
    renderWelcomeScreen();
    expect(screen.getByText(jaFull.welcome_screen.tagline)).toBeInTheDocument();
  });

  it("renders the tagline in Japanese", () => {
    renderWelcomeScreen(vi.fn(), jaFull);
    expect(
      screen.getByText("アニメの舞台を探して、巡礼ルートを作ろう"),
    ).toBeInTheDocument();
  });

  it("renders 3 quick-action chips with i18n labels", () => {
    renderWelcomeScreen();
    // Labels come from dict.welcome_screen.action_*
    expect(screen.getByText(jaFull.welcome_screen.action_search)).toBeInTheDocument();
    expect(screen.getByText(jaFull.welcome_screen.action_nearby)).toBeInTheDocument();
    expect(screen.getByText(jaFull.welcome_screen.action_route)).toBeInTheDocument();
  });

  it("quick-action chip fills input instead of sending", () => {
    renderWelcomeScreen();
    fireEvent.click(screen.getByText(jaFull.welcome_screen.action_search));
    const input = screen.getByPlaceholderText(/アニメ名を入力/);
    expect(input).toHaveValue("君の名は の聖地を教えて");
  });

  it("nearby chip fills input with nearby query", () => {
    renderWelcomeScreen();
    fireEvent.click(screen.getByText(jaFull.welcome_screen.action_nearby));
    const input = screen.getByPlaceholderText(/アニメ名を入力/);
    expect(input).toHaveValue("現在地の近くにある聖地を教えて");
  });

  it("route chip fills input with route query", () => {
    renderWelcomeScreen();
    fireEvent.click(screen.getByText(jaFull.welcome_screen.action_route));
    const input = screen.getByPlaceholderText(/アニメ名を入力/);
    expect(input).toHaveValue("響け！ユーフォニアム の聖地を巡るルートを作って");
  });

  it("renders anime cover chips when bangumi popular data loads", async () => {
    server.use(
      http.get("http://localhost:8000/v1/bangumi/popular", () => {
        return HttpResponse.json({
          bangumi: [
            { bangumi_id: "bg-001", title: "响け", cover_url: "https://image.anitabi.cn/bangumi/bg-001.jpg" },
            { bangumi_id: "bg-002", title: "テスト2", cover_url: "https://image.anitabi.cn/bangumi/bg-002.jpg" },
            { bangumi_id: "bg-003", title: "テスト3", cover_url: "https://image.anitabi.cn/bangumi/bg-003.jpg" },
            { bangumi_id: "bg-004", title: "テスト4", cover_url: "https://image.anitabi.cn/bangumi/bg-004.jpg" },
          ],
        });
      }),
    );
    renderWelcomeScreen();
    const chip = await screen.findByTitle("响け");
    expect(chip).toBeInTheDocument();
  });

  it("does not crash when /v1/bangumi/popular returns empty", async () => {
    server.use(
      http.get("http://localhost:8000/v1/bangumi/popular", () => {
        return HttpResponse.json({ bangumi: [] });
      }),
    );
    expect(() => renderWelcomeScreen()).not.toThrow();
    expect(screen.getByText(jaFull.welcome_screen.action_search)).toBeInTheDocument();
    // Fallback covers appear after loading finishes
    const cover = await screen.findByTitle("響け！ユーフォニアム");
    expect(cover).toBeInTheDocument();
  });

  it("does not crash on /v1/bangumi/popular network failure", async () => {
    server.use(
      http.get("http://localhost:8000/v1/bangumi/popular", () => {
        return HttpResponse.error();
      }),
    );
    expect(() => renderWelcomeScreen()).not.toThrow();
    expect(screen.getByText(jaFull.welcome_screen.action_search)).toBeInTheDocument();
  });

  it("renders tagline in Chinese when zh dict provided", () => {
    renderWelcomeScreen(vi.fn(), zhFull, "zh");
    expect(screen.getByText("探索动漫圣地，踏上巡礼之旅")).toBeInTheDocument();
  });

  it("renders tagline in English when en dict provided", () => {
    renderWelcomeScreen(vi.fn(), enFull, "en");
    expect(
      screen.getByText("Find anime filming locations and plan your pilgrimage route"),
    ).toBeInTheDocument();
  });

  it("renders quick-action labels in Chinese", () => {
    renderWelcomeScreen(vi.fn(), zhFull, "zh");
    expect(screen.getByText(zhFull.welcome_screen.action_search)).toBeInTheDocument();
    expect(screen.getByText(zhFull.welcome_screen.action_nearby)).toBeInTheDocument();
    expect(screen.getByText(zhFull.welcome_screen.action_route)).toBeInTheDocument();
  });

  it("renders quick-action labels in English", () => {
    renderWelcomeScreen(vi.fn(), enFull, "en");
    expect(screen.getByText(enFull.welcome_screen.action_search)).toBeInTheDocument();
    expect(screen.getByText(enFull.welcome_screen.action_nearby)).toBeInTheDocument();
    expect(screen.getByText(enFull.welcome_screen.action_route)).toBeInTheDocument();
  });
});
