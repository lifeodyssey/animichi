/**
 * Tests for AnimeGuideClient component:
 * - Not-found state when initialData is null
 * - Guide content rendering (title, spots, city, cover)
 * - Locale-aware title display (zh)
 * - Episode/Area toggle behavior
 * - CTA button presence
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import zhDict from "@/lib/dictionaries/zh.json";
import type { AnimeGuideResponse } from "@/lib/api";

const mockUseDict = vi.fn(() => jaDict as Dict);
const mockUseLocale = vi.fn(() => "ja");

vi.mock("@/lib/i18n-context", () => ({
  useDict: mockUseDict,
  useLocale: mockUseLocale,
  useSetLocale: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/anime/123",
}));

vi.mock("@/lib/supabase/browser", () => ({
  createClient: vi.fn(() => ({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  })),
}));

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/hooks/useScrollReveal", () => ({ useScrollReveal: () => vi.fn() }));

const MOCK_GUIDE: AnimeGuideResponse = {
  bangumi_id: "115908",
  title: "響け！ユーフォニアム",
  title_cn: "吹响吧！上低音号",
  cover_url: "https://image.anitabi.cn/bangumi/115908.jpg",
  city: "宇治市",
  spot_count: 5,
  spots: [
    { id: "s1", name: "宇治橋", name_cn: "宇治桥", episode: 1, time_seconds: null, screenshot_url: "https://example.com/1.jpg", bangumi_id: "115908", latitude: 34.8891, longitude: 135.8074, title: "響け！ユーフォニアム", title_cn: "吹响吧！上低音号", origin: null, city: "Uji" },
    { id: "s2", name: "京阪宇治駅", name_cn: null, episode: 2, time_seconds: null, screenshot_url: "https://example.com/2.jpg", bangumi_id: "115908", latitude: 34.8900, longitude: 135.8080, title: "響け！ユーフォニアム", title_cn: null, origin: null, city: "Uji" },
    { id: "s3", name: "宇治神社", name_cn: null, episode: 3, time_seconds: null, screenshot_url: null, bangumi_id: "115908", latitude: 34.8895, longitude: 135.8090, title: "響け！ユーフォニアム", title_cn: null, origin: null, city: "Uji" },
  ],
  bounds: { north: 34.89, south: 34.88, east: 135.81, west: 135.80 },
};

describe("AnimeGuideClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDict.mockReturnValue(jaDict as Dict);
    mockUseLocale.mockReturnValue("ja");
    sessionStorage.clear();
  });

  it("renders not-found when initialData is null", async () => {
    const { default: AnimeGuideClient } = await import("@/app/anime/[bangumiId]/AnimeGuideClient");
    render(<AnimeGuideClient initialData={null} bangumiId="99999" />);

    expect(screen.getByText(jaDict.anime_guide.not_found)).toBeDefined();
    expect(screen.getByText(jaDict.anime_guide.not_found_hint)).toBeDefined();
  });

  it("renders guide content when initialData is provided", async () => {
    const { default: AnimeGuideClient } = await import("@/app/anime/[bangumiId]/AnimeGuideClient");
    render(<AnimeGuideClient initialData={MOCK_GUIDE} bangumiId="115908" />);

    expect(screen.getByRole("heading", { level: 1, name: "響け！ユーフォニアム" })).toBeDefined();
    expect(screen.getByText("5 スポット")).toBeDefined();
    expect(screen.getByText("宇治市")).toBeDefined();
  });

  it("displays cover image when cover_url exists", async () => {
    const { default: AnimeGuideClient } = await import("@/app/anime/[bangumiId]/AnimeGuideClient");
    render(<AnimeGuideClient initialData={MOCK_GUIDE} bangumiId="115908" />);

    const img = screen.getByAltText("響け！ユーフォニアム");
    expect(img).toBeDefined();
    expect(img.getAttribute("src")).toBe("https://image.anitabi.cn/bangumi/115908.jpg");
  });

  it("shows Chinese title when locale is zh", async () => {
    mockUseDict.mockReturnValue(zhDict as Dict);
    mockUseLocale.mockReturnValue("zh");

    const { default: AnimeGuideClient } = await import("@/app/anime/[bangumiId]/AnimeGuideClient");
    render(<AnimeGuideClient initialData={MOCK_GUIDE} bangumiId="115908" />);

    expect(screen.getByRole("heading", { level: 1, name: "吹响吧！上低音号" })).toBeDefined();
  });

  it("episode/area toggle switches grouping", async () => {
    const { default: AnimeGuideClient } = await import("@/app/anime/[bangumiId]/AnimeGuideClient");
    render(<AnimeGuideClient initialData={MOCK_GUIDE} bangumiId="115908" />);

    await waitFor(() => {
      expect(screen.getByText("第 1 話")).toBeDefined();
    });

    const areaBtn = screen.getByRole("button", { name: jaDict.anime_guide.area_tab });
    fireEvent.click(areaBtn);

    await waitFor(() => {
      expect(screen.getAllByText("宇治市").length).toBeGreaterThanOrEqual(2);
      expect(screen.queryByText("第 1 話")).toBeNull();
    });
  });

  it("CTA button is present", async () => {
    const { default: AnimeGuideClient } = await import("@/app/anime/[bangumiId]/AnimeGuideClient");
    render(<AnimeGuideClient initialData={MOCK_GUIDE} bangumiId="115908" />);

    const cta = screen.getByRole("button", { name: new RegExp(jaDict.anime_guide.plan_route) });
    expect(cta).toBeDefined();
  });
});
