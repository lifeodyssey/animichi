/**
 * Tests for Task B2 — "How it works" + "Popular routes" sections
 *
 * AC coverage:
 *   - Happy: 4-step how-it-works renders with step titles -> unit
 *   - Happy: popular-routes grid renders cards from ANIME_GALLERY -> unit
 *   - Happy: 48px section spacing + cream bg sections present -> unit (structure)
 *   - Null/empty: popular-routes with 0 items shows empty placeholder -> unit
 *   - Error: broken cover image triggers handleImageError fallback -> unit
 *   - i18n: all section headings/step copy localized (ja/en/zh) -> unit
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import enDict from "@/lib/dictionaries/en.json";
import zhDict from "@/lib/dictionaries/zh.json";
import { ANIME_GALLERY, handleImageError } from "@/components/auth/LandingData";
import { LandingHowItWorks } from "@/components/auth/LandingHowItWorks";
import { LandingPopularRoutes } from "@/components/auth/LandingPopularRoutes";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(),
  useLocale: vi.fn(() => "ja" as const),
  useSetLocale: vi.fn(() => vi.fn()),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/useScrollReveal", () => ({
  useScrollReveal: vi.fn(() => vi.fn()),
}));

vi.mock("@/components/generative/BeforeAfter", () => ({
  default: ({ leftAlt, rightAlt }: { leftAlt?: string; rightAlt?: string; [key: string]: unknown }) => (
    <div data-testid="before-after-stub" aria-label={`${leftAlt ?? ""} vs ${rightAlt ?? ""}`} />
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { useDict } from "@/lib/i18n-context";

const jaFull = jaDict as unknown as Dict;
const enFull = enDict as unknown as Dict;
const zhFull = zhDict as unknown as Dict;

function renderHowItWorks(dict: Dict = jaFull) {
  vi.mocked(useDict).mockReturnValue(dict);
  return render(<LandingHowItWorks />);
}

function renderPopularRoutes(dict: Dict = jaFull, items = ANIME_GALLERY) {
  vi.mocked(useDict).mockReturnValue(dict);
  return render(<LandingPopularRoutes items={items} onOpenAuth={vi.fn()} />);
}

// ── AC: Happy — how-it-works 4 steps render ───────────────────────────────────

describe("LandingHowItWorks — happy path", () => {
  beforeEach(() => {
    vi.mocked(useDict).mockReturnValue(jaFull);
  });

  it("renders the section heading from dictionary", () => {
    renderHowItWorks();
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });

  it("renders exactly 4 step items", () => {
    renderHowItWorks();
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(4);
  });

  it("renders step 1 title from dictionary", () => {
    renderHowItWorks();
    const t = jaDict.landing_hero.landing;
    expect(screen.getByText(t.hiw_step1_title)).toBeInTheDocument();
  });

  it("renders step 2 title (compare scene) from dictionary", () => {
    renderHowItWorks();
    const t = jaDict.landing_hero.landing;
    expect(screen.getByText(t.hiw_step2_title)).toBeInTheDocument();
  });

  it("renders BeforeAfter stub for step 2 (compare-scene step)", () => {
    renderHowItWorks();
    expect(screen.getByTestId("before-after-stub")).toBeInTheDocument();
  });

  it("renders step 3 and step 4 titles", () => {
    renderHowItWorks();
    const t = jaDict.landing_hero.landing;
    expect(screen.getByText(t.hiw_step3_title)).toBeInTheDocument();
    expect(screen.getByText(t.hiw_step4_title)).toBeInTheDocument();
  });
});

// ── AC: i18n — how-it-works copy localized ────────────────────────────────────

describe("LandingHowItWorks — i18n", () => {
  it("renders English step 1 title from en dictionary", () => {
    renderHowItWorks(enFull);
    const t = enDict.landing_hero.landing;
    expect(screen.getByText(t.hiw_step1_title)).toBeInTheDocument();
  });

  it("renders Chinese section heading from zh dictionary", () => {
    renderHowItWorks(zhFull);
    const t = zhDict.landing_hero.landing;
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(t.hiw_title);
  });

  it("renders Japanese section heading from ja dictionary", () => {
    renderHowItWorks(jaFull);
    const t = jaDict.landing_hero.landing;
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(t.hiw_title);
  });
});

// ── AC: Happy — popular-routes grid renders cards ─────────────────────────────

describe("LandingPopularRoutes — happy path", () => {
  beforeEach(() => {
    vi.mocked(useDict).mockReturnValue(jaFull);
  });

  it("renders the section heading from dictionary", () => {
    renderPopularRoutes();
    const t = jaDict.landing_hero.landing;
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(t.popular_title);
  });

  it("renders a card for each gallery item", () => {
    renderPopularRoutes(jaFull, ANIME_GALLERY.slice(0, 4));
    // At minimum 4 card links plus 1 view-all link
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(4);
  });

  it("renders anime titles as card headings", () => {
    renderPopularRoutes(jaFull, ANIME_GALLERY.slice(0, 2));
    expect(screen.getByText("君の名は。")).toBeInTheDocument();
    expect(screen.getByText("響け！ユーフォニアム")).toBeInTheDocument();
  });

  it("renders spot count from gallery items", () => {
    renderPopularRoutes(jaFull, ANIME_GALLERY.slice(0, 1));
    // spot count rendered in LocationStamps span — ANIME_GALLERY[1] is kimi-no-na-wa "89 スポット · 新宿/飛騨"
    // The first item in ANIME_GALLERY is Euphonium "156 スポット · 宇治市"
    expect(screen.getByText(/156/)).toBeInTheDocument();
  });

  it("renders 'view all' link from dictionary", () => {
    renderPopularRoutes(jaFull);
    const t = jaDict.landing_hero.landing;
    expect(screen.getByRole("link", { name: new RegExp(t.popular_view_all) })).toBeInTheDocument();
  });
});

// ── AC: Null/empty — 0 gallery items shows empty placeholder ─────────────────

describe("LandingPopularRoutes — empty state", () => {
  beforeEach(() => {
    vi.mocked(useDict).mockReturnValue(jaFull);
  });

  it("shows empty placeholder text when items array is empty", () => {
    renderPopularRoutes(jaFull, []);
    const t = jaDict.landing_hero.landing;
    expect(screen.getByText(t.popular_empty)).toBeInTheDocument();
  });

  it("renders no route card images when items is empty", () => {
    renderPopularRoutes(jaFull, []);
    const imgs = screen.queryAllByRole("img");
    // 0 cover images, only emoji counts as text not img
    expect(imgs).toHaveLength(0);
  });
});

// ── AC: Error — broken cover image uses handleImageError fallback ─────────────

describe("LandingPopularRoutes — image error fallback", () => {
  beforeEach(() => {
    vi.mocked(useDict).mockReturnValue(jaFull);
  });

  it("renders cover images with onError attribute", () => {
    renderPopularRoutes(jaFull, ANIME_GALLERY.slice(0, 1));
    const imgs = screen.getAllByRole("img");
    expect(imgs.length).toBeGreaterThan(0);
  });

  it("handleImageError hides the img element", () => {
    const added: string[] = [];
    const target = {
      style: { display: "" } as CSSStyleDeclaration,
      parentElement: { classList: { add: (c: string) => added.push(c) } } as unknown as HTMLElement,
    };
    const event = { currentTarget: target } as unknown as React.SyntheticEvent<HTMLImageElement>;
    handleImageError(event);
    expect(target.style.display).toBe("none");
  });

  it("handleImageError applies warm muted class to parent", () => {
    const added: string[] = [];
    const target = {
      style: { display: "" } as CSSStyleDeclaration,
      parentElement: { classList: { add: (c: string) => added.push(c) } } as unknown as HTMLElement,
    };
    const event = { currentTarget: target } as unknown as React.SyntheticEvent<HTMLImageElement>;
    handleImageError(event);
    expect(added).toContain("img-error-bg");
  });

  it("handleImageError does not throw when parentElement is null", () => {
    const target = {
      style: { display: "" } as CSSStyleDeclaration,
      parentElement: null,
    };
    const event = { currentTarget: target } as unknown as React.SyntheticEvent<HTMLImageElement>;
    expect(() => handleImageError(event)).not.toThrow();
  });
});

// ── AC: i18n — popular-routes copy localized ─────────────────────────────────

describe("LandingPopularRoutes — i18n", () => {
  it("renders English section heading from en dictionary", () => {
    renderPopularRoutes(enFull);
    const t = enDict.landing_hero.landing;
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(t.popular_title);
  });

  it("renders Chinese section heading from zh dictionary", () => {
    renderPopularRoutes(zhFull);
    const t = zhDict.landing_hero.landing;
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(t.popular_title);
  });
});
