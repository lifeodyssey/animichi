/**
 * Tests for Guide page CTA auth behavior:
 * - Logged in → navigates to /chat?q=...
 * - Not logged in → opens LoginModal
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import AnimeGuideClient from "@/app/anime/[bangumiId]/AnimeGuideClient";

// Mock i18n
vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(() => jaDict as Dict),
  useLocale: vi.fn(() => "ja"),
  useSetLocale: vi.fn(),
}));

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
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

// Mock dynamic imports (map)
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

// Mock scroll reveal
vi.mock("@/hooks/useScrollReveal", () => ({
  useScrollReveal: () => vi.fn(),
}));

const MOCK_DATA = {
  bangumi_id: "485",
  title: "涼宮ハルヒの憂鬱",
  title_cn: "凉宫春日的忧郁",
  cover_url: null,
  city: "西宮市",
  spot_count: 70,
  spots: [],
  bounds: null,
};

describe("Guide page CTA — logged in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "jwt", user: { id: "u1" } } },
    });
  });

  it("navigates to /chat when CTA is clicked", async () => {
    render(<AnimeGuideClient initialData={MOCK_DATA} bangumiId="485" />);

    await waitFor(() => {
      expect(screen.getAllByText(jaDict.anime_guide.plan_route).length).toBeGreaterThan(0);
    });

    const ctaButton = screen.getByRole("button", { name: new RegExp(jaDict.anime_guide.plan_route) });
    fireEvent.click(ctaButton);

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("/chat?q="));
  });
});

describe("Guide page CTA — not logged in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: { session: null },
    });
  });

  it("opens login modal when CTA is clicked", async () => {
    render(<AnimeGuideClient initialData={MOCK_DATA} bangumiId="485" />);

    await waitFor(() => {
      expect(screen.getAllByText(jaDict.anime_guide.plan_route).length).toBeGreaterThan(0);
    });

    const ctaButton = screen.getByRole("button", { name: new RegExp(jaDict.anime_guide.plan_route) });
    fireEvent.click(ctaButton);

    expect(mockPush).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeDefined();
    });
  });
});
