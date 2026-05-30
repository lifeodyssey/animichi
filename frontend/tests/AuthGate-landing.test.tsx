/**
 * Unit tests for Landing page (v2 — animal-island-ui redesign)
 *
 * AC: Landing hero headline, search input, gallery, 4-step section in all 3 locales -> unit
 * AC: No session / first visit — landing renders with all sections visible -> unit (jsdom)
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import zhDict from "@/lib/dictionaries/zh.json";
import enDict from "@/lib/dictionaries/en.json";

const jaFull = jaDict as unknown as Dict;
const zhFull = zhDict as unknown as Dict;
const enFull = enDict as unknown as Dict;

vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(),
  useLocale: vi.fn(() => "ja"),
  useSetLocale: vi.fn(() => vi.fn()),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ replace: vi.fn(), push: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { useDict } from "@/lib/i18n-context";
import LandingPage from "@/components/auth/LandingPage";

function renderLanding(dict: Dict = jaFull) {
  vi.mocked(useDict).mockReturnValue(dict);
  return render(<LandingPage onOpenAuth={vi.fn()} />);
}

// ── Locale: Japanese ──

describe("Landing page — Japanese (ja)", () => {
  it("renders the hero headline", () => {
    renderLanding(jaFull);
    expect(screen.getByText(/アニメの場面を/)).toBeInTheDocument();
  });

  it("renders hero lead text", () => {
    renderLanding(jaFull);
    expect(screen.getByText(/作品名・駅名・都市名を入力/)).toBeInTheDocument();
  });

  it("renders CTA button", () => {
    renderLanding(jaFull);
    expect(screen.getByText("巡礼を始める")).toBeInTheDocument();
  });

  it("renders search input with placeholder", () => {
    renderLanding(jaFull);
    expect(screen.getByPlaceholderText("作品名・駅名・都市名を入力")).toBeInTheDocument();
  });

  it("renders gallery title", () => {
    renderLanding(jaFull);
    expect(screen.getByText(/人気の巡礼ルート/)).toBeInTheDocument();
  });

  it("renders login button", () => {
    renderLanding(jaFull);
    const logins = screen.getAllByText("ログイン");
    expect(logins.length).toBeGreaterThanOrEqual(1);
  });

  it("renders 4-step section titles", () => {
    renderLanding(jaFull);
    expect(screen.getByText("聖地を探す")).toBeInTheDocument();
    expect(screen.getByText("地点を選ぶ")).toBeInTheDocument();
    expect(screen.getByText("ルート生成")).toBeInTheDocument();
    expect(screen.getByText("エクスポート")).toBeInTheDocument();
  });
});

// ── Locale: Chinese ──

describe("Landing page — Chinese (zh)", () => {
  it("renders hero headline in Chinese", () => {
    renderLanding(zhFull);
    expect(screen.getByText(/把动画场景/)).toBeInTheDocument();
  });

  it("renders CTA in Chinese", () => {
    renderLanding(zhFull);
    expect(screen.getByText("开始巡礼")).toBeInTheDocument();
  });

  it("renders gallery title in Chinese", () => {
    renderLanding(zhFull);
    expect(screen.getByText(/热门巡礼路线/)).toBeInTheDocument();
  });

  it("renders 4-step section in Chinese", () => {
    renderLanding(zhFull);
    expect(screen.getByText("找圣地")).toBeInTheDocument();
    expect(screen.getByText("导出分享")).toBeInTheDocument();
  });
});

// ── Locale: English ──

describe("Landing page — English (en)", () => {
  it("renders hero headline in English", () => {
    renderLanding(enFull);
    expect(screen.getByText(/Turn anime scenes/)).toBeInTheDocument();
  });

  it("renders CTA in English", () => {
    renderLanding(enFull);
    expect(screen.getByText("Start Exploring")).toBeInTheDocument();
  });

  it("renders gallery title in English", () => {
    renderLanding(enFull);
    expect(screen.getByText(/Popular pilgrimage routes/)).toBeInTheDocument();
  });

  it("renders login button in English", () => {
    renderLanding(enFull);
    const logins = screen.getAllByText("Log in");
    expect(logins.length).toBeGreaterThanOrEqual(1);
  });

  it("renders 4-step section in English", () => {
    renderLanding(enFull);
    expect(screen.getByText("Find spots")).toBeInTheDocument();
    expect(screen.getByText("Export & share")).toBeInTheDocument();
  });
});

// ── Structural ──

describe("Landing page — structure", () => {
  it("renders header + footer brand name", () => {
    renderLanding(jaFull);
    const all = screen.getAllByText("聖地巡礼");
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("gallery cards link to anime guide pages", () => {
    const { container } = renderLanding(jaFull);
    const galleryLinks = container.querySelectorAll("a[href*='/anime/']");
    expect(galleryLinks.length).toBe(4);
    expect(galleryLinks[0].getAttribute("href")).toContain("/anime/");
  });

  it("renders view-all button", () => {
    renderLanding(jaFull);
    expect(screen.getByText(/すべてのルートを見る/)).toBeInTheDocument();
  });
});
