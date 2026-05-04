/**
 * Tests for Guide page CTA auth behavior:
 * - Logged in → navigates to /chat?q=...
 * - Not logged in → opens LoginModal
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";

// Mock i18n
vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(() => jaDict as Dict),
  useLocale: vi.fn(() => "ja"),
  useSetLocale: vi.fn(),
}));

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ bangumiId: "485" }),
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock supabase
const mockGetSession = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  createClient: vi.fn(() => ({
    auth: { getSession: mockGetSession },
  })),
}));

// Mock API
vi.mock("@/lib/api", () => ({
  fetchAnimeGuide: vi.fn().mockResolvedValue({
    bangumi_id: "485",
    title: "涼宮ハルヒの憂鬱",
    title_cn: "凉宫春日的忧郁",
    cover_url: null,
    city: "西宮市",
    spot_count: 70,
    spots: [],
    bounds: null,
  }),
}));

// Mock dynamic imports (map)
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

// Mock scroll reveal
vi.mock("@/hooks/useScrollReveal", () => ({
  useScrollReveal: () => vi.fn(),
}));

describe("Guide page CTA auth behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockReset();
  });

  it("navigates to /chat when user is logged in", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "jwt", user: { id: "u1" } } },
    });

    const { default: AnimeGuidePage } = await import("@/app/anime/[bangumiId]/page");
    render(<AnimeGuidePage />);

    await waitFor(() => {
      expect(screen.getAllByText(jaDict.anime_guide.plan_route).length).toBeGreaterThan(0);
    });

    const ctaButton = screen.getByRole("button", { name: new RegExp(jaDict.anime_guide.plan_route) });
    fireEvent.click(ctaButton);

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining("/chat?q="),
    );
  });

  it("opens login modal when user is not logged in", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
    });

    vi.resetModules();

    // Re-apply mocks after resetModules
    vi.doMock("@/lib/i18n-context", () => ({
      useDict: vi.fn(() => jaDict as Dict),
      useLocale: vi.fn(() => "ja"),
      useSetLocale: vi.fn(),
    }));
    vi.doMock("next/navigation", () => ({
      useParams: () => ({ bangumiId: "485" }),
      useRouter: () => ({ push: mockPush, replace: vi.fn() }),
      useSearchParams: () => new URLSearchParams(),
    }));
    vi.doMock("@/lib/supabase/browser", () => ({
      createClient: vi.fn(() => ({
        auth: { getSession: mockGetSession },
      })),
    }));
    vi.doMock("@/lib/api", () => ({
      fetchAnimeGuide: vi.fn().mockResolvedValue({
        bangumi_id: "485",
        title: "涼宮ハルヒの憂鬱",
        title_cn: "凉宫春日的忧郁",
        cover_url: null,
        city: "西宮市",
        spot_count: 70,
        spots: [],
        bounds: null,
      }),
    }));
    vi.doMock("next/dynamic", () => ({ default: () => () => null }));
    vi.doMock("@/hooks/useScrollReveal", () => ({ useScrollReveal: () => vi.fn() }));

    const { default: AnimeGuidePage } = await import("@/app/anime/[bangumiId]/page");
    render(<AnimeGuidePage />);

    await waitFor(() => {
      expect(screen.getAllByText(jaDict.anime_guide.plan_route).length).toBeGreaterThan(0);
    });

    const ctaButton = screen.getByRole("button", { name: new RegExp(jaDict.anime_guide.plan_route) });
    fireEvent.click(ctaButton);

    // Should NOT navigate
    expect(mockPush).not.toHaveBeenCalled();

    // Should show login modal (dialog role)
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeDefined();
    });
  });
});
