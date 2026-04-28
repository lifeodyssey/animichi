/**
 * Unit tests for Landing page (redesigned)
 *
 * AC: Landing hero text, stats labels, gallery render in all 3 locales -> unit
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

// Mock next/navigation for Link and useRouter
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ replace: vi.fn(), push: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

// Mock next/link
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
  it("renders the hero title", () => {
    renderLanding(jaFull);
    const headings = screen.getAllByText("聖地巡礼");
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it("renders hero subtitle", () => {
    renderLanding(jaFull);
    expect(
      screen.getByText("アニメの舞台を探して、巡礼ルートを作ろう"),
    ).toBeInTheDocument();
  });

  it("renders CTA button with honest text", () => {
    renderLanding(jaFull);
    expect(screen.getByText("巡礼を始める")).toBeInTheDocument();
  });

  it("renders spot count stat label", () => {
    renderLanding(jaFull);
    expect(screen.getByText("スポット")).toBeInTheDocument();
  });

  it("renders anime count stat label", () => {
    renderLanding(jaFull);
    const elements = screen.getAllByText("作品");
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it("renders prefecture stat label", () => {
    renderLanding(jaFull);
    expect(screen.getByText("都道府県")).toBeInTheDocument();
  });

  it("renders stat numbers", () => {
    renderLanding(jaFull);
    expect(screen.getByText("2,400+")).toBeInTheDocument();
    expect(screen.getByText("180+")).toBeInTheDocument();
    expect(screen.getByText("47")).toBeInTheDocument();
  });

  it("renders gallery title", () => {
    renderLanding(jaFull);
    expect(screen.getByText("人気作品")).toBeInTheDocument();
  });

  it("renders login button", () => {
    renderLanding(jaFull);
    expect(screen.getByText("ログイン")).toBeInTheDocument();
  });
});

// ── Locale: Chinese ──

describe("Landing page — Chinese (zh)", () => {
  it("renders hero subtitle in Chinese", () => {
    renderLanding(zhFull);
    expect(
      screen.getByText("探索动漫圣地，踏上巡礼之旅"),
    ).toBeInTheDocument();
  });

  it("renders CTA in Chinese", () => {
    renderLanding(zhFull);
    expect(screen.getByText("开始巡礼")).toBeInTheDocument();
  });

  it("renders spot stat label in Chinese", () => {
    renderLanding(zhFull);
    expect(screen.getByText("取景地")).toBeInTheDocument();
  });

  it("renders gallery title in Chinese", () => {
    renderLanding(zhFull);
    expect(screen.getByText("热门作品")).toBeInTheDocument();
  });
});

// ── Locale: English ──

describe("Landing page — English (en)", () => {
  it("renders hero subtitle in English", () => {
    renderLanding(enFull);
    expect(
      screen.getByText(
        "Find anime filming locations and plan your pilgrimage route",
      ),
    ).toBeInTheDocument();
  });

  it("renders CTA in English", () => {
    renderLanding(enFull);
    expect(screen.getByText("Start Exploring")).toBeInTheDocument();
  });

  it("renders spot stat label in English", () => {
    renderLanding(enFull);
    expect(screen.getByText("spots")).toBeInTheDocument();
  });

  it("renders gallery title in English", () => {
    renderLanding(enFull);
    expect(screen.getByText("Popular anime")).toBeInTheDocument();
  });

  it("renders login button in English", () => {
    renderLanding(enFull);
    expect(screen.getByText("Log in")).toBeInTheDocument();
  });
});

// ── Structural ──

describe("Landing page — structure", () => {
  it("hero section is present", () => {
    const { container } = renderLanding(jaFull);
    expect(container.querySelector("[data-testid='hero-section']")).not.toBeNull();
  });

  it("gallery section is present", () => {
    const { container } = renderLanding(jaFull);
    expect(container.querySelector("[data-testid='gallery-section']")).not.toBeNull();
  });

  it("renders footer with brand name", () => {
    renderLanding(jaFull);
    const all = screen.getAllByText("聖地巡礼");
    expect(all.length).toBeGreaterThanOrEqual(2); // header + footer
  });

  it("gallery cards link to search pages", () => {
    const { container } = renderLanding(jaFull);
    const galleryLinks = container.querySelectorAll(
      "[data-testid='gallery-section'] a",
    );
    expect(galleryLinks.length).toBe(8);
    const firstHref = galleryLinks[0].getAttribute("href");
    expect(firstHref).toContain("/search?q=");
  });

  it("does not render search input (no fake search bar)", () => {
    renderLanding(jaFull);
    expect(screen.queryByPlaceholderText("アニメの聖地を探す...")).not.toBeInTheDocument();
  });

  it("does not render 3-step section (removed)", () => {
    const { container } = renderLanding(jaFull);
    expect(container.querySelector("[data-testid='steps-section']")).toBeNull();
  });
});
