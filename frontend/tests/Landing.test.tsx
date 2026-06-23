/**
 * Tests for the rebuilt landing hero (components/landing/).
 *
 * AC coverage:
 *   - Happy: page composes header + hero + footer; scene card renders photos,
 *     corner tags, and the fox mascot -> unit
 *   - Happy: search submit passes the trimmed query to onOpenAuth -> unit
 *   - Happy: example chip fills the input and triggers the search path -> integration
 *   - Null/empty: empty search submit is a no-op; empty example list renders
 *     without chips and without crashing -> unit
 *   - i18n: headline + CTA come from the dictionary in all 3 locales -> unit
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import enDict from "@/lib/dictionaries/en.json";
import zhDict from "@/lib/dictionaries/zh.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(),
  useLocale: vi.fn(() => "ja"),
  useSetLocale: vi.fn(() => vi.fn()),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ replace: vi.fn(), push: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  usePathname: vi.fn(() => "/"),
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

vi.mock("@/components/generative/FoxGuide", () => ({
  default: ({ pose }: { pose: string; [key: string]: unknown }) => (
    <div data-testid="fox-guide-mock" data-pose={pose} />
  ),
}));

import { useDict } from "@/lib/i18n-context";
import LandingPage from "@/components/landing/LandingPage";
import ShowcaseCard from "@/components/landing/ShowcaseCard";

const jaFull = jaDict;
const enFull = enDict;
const zhFull = zhDict;
const tja = jaDict.landing_hero.landing;

function renderLanding(dict: Dict = jaFull, onOpenAuth = vi.fn()) {
  vi.mocked(useDict).mockReturnValue(dict);
  return render(<LandingPage onOpenAuth={onOpenAuth} />);
}

describe("landing — composition", () => {
  it("renders the header brand and the footer bar", () => {
    renderLanding(jaFull);
    expect(screen.getAllByText("聖地巡礼").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });

  it("renders the eyebrow line from the dictionary", () => {
    renderLanding(jaFull);
    expect(screen.getByText(tja.hero_eyebrow)).toBeInTheDocument();
  });
});

describe("landing — showcase card", () => {
  it("renders the anime and real photos with localized alt text", () => {
    renderLanding(jaFull);
    expect(screen.getByAltText(tja.hero_anime_label)).toBeInTheDocument();
    expect(screen.getByAltText(tja.hero_real_label)).toBeInTheDocument();
  });

  it("renders the anime and real corner tags", () => {
    renderLanding(jaFull);
    expect(screen.getAllByText(tja.hero_anime_label).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(tja.hero_real_label).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the fox mascot in its lounging pose", () => {
    renderLanding(jaFull);
    expect(screen.getByTestId("fox-guide-mock")).toHaveAttribute("data-pose", "lean");
  });
});

describe("landing — search", () => {
  it("calls onOpenAuth with the trimmed query when submitted", () => {
    const onOpenAuth = vi.fn();
    renderLanding(jaFull, onOpenAuth);
    fireEvent.change(screen.getByPlaceholderText(tja.search_placeholder), {
      target: { value: "  凪のあすから  " },
    });
    fireEvent.click(screen.getByRole("button", { name: tja.search_button }));
    expect(onOpenAuth).toHaveBeenCalledWith("凪のあすから");
  });

  it("does not call onOpenAuth when the input is empty", () => {
    const onOpenAuth = vi.fn();
    renderLanding(jaFull, onOpenAuth);
    fireEvent.click(screen.getByRole("button", { name: tja.search_button }));
    expect(onOpenAuth).not.toHaveBeenCalled();
  });

  it("submits on the Enter key", () => {
    const onOpenAuth = vi.fn();
    renderLanding(jaFull, onOpenAuth);
    const input = screen.getByPlaceholderText(tja.search_placeholder);
    fireEvent.change(input, { target: { value: "ユーフォニアム" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenAuth).toHaveBeenCalledWith("ユーフォニアム");
  });

  it("opens auth from the header login button", () => {
    const onOpenAuth = vi.fn();
    renderLanding(jaFull, onOpenAuth);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(tja.login) }));
    expect(onOpenAuth).toHaveBeenCalled();
  });
});

describe("landing — showcase card variants", () => {
  it("renders without the fox when showFox is false", () => {
    vi.mocked(useDict).mockReturnValue(jaFull);
    render(
      <ShowcaseCard
        anime={{ src: "/a.webp", alt: "Anime" }}
        real={{ src: "/r.webp", alt: "Real" }}
        showFox={false}
      />,
    );
    expect(screen.getByAltText("Anime")).toBeInTheDocument();
    expect(screen.queryByTestId("fox-guide-mock")).not.toBeInTheDocument();
  });
});

describe("landing — example chips", () => {
  const examples = (tja.hero_examples).slice(0, 3);

  it("renders the example chips from the dictionary", () => {
    renderLanding(jaFull);
    for (const example of examples) {
      expect(screen.getByRole("button", { name: example })).toBeInTheDocument();
    }
  });

  it("fills the search input and triggers the search path when a chip is tapped", () => {
    const onOpenAuth = vi.fn();
    renderLanding(jaFull, onOpenAuth);
    const [firstExample = ""] = examples;
    fireEvent.click(screen.getByRole("button", { name: firstExample }));
    expect(screen.getByRole("textbox")).toHaveValue(firstExample);
    expect(onOpenAuth).toHaveBeenCalledWith(firstExample);
  });

  it("renders the hero without chips when the example list is empty", () => {
    const dictNoExamples = {
      ...jaFull,
      landing_hero: {
        ...jaFull.landing_hero,
        landing: { ...jaFull.landing_hero.landing, hero_examples: [] as string[] },
      },
    };
    renderLanding(dictNoExamples);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByText(tja.hero_examples[0] ?? "")).not.toBeInTheDocument();
  });
});

describe("landing — i18n", () => {
  const LOCALES = [
    { locale: "ja", dict: jaFull, headline: /アニメの場面を/, cta: "巡礼を始める" },
    { locale: "en", dict: enFull, headline: /Turn anime scenes/, cta: "Start Exploring" },
    { locale: "zh", dict: zhFull, headline: /把动画场景/, cta: "开始巡礼" },
  ];

  it.each(LOCALES)("renders the $locale headline and CTA from the dictionary", ({ dict, headline, cta }) => {
    renderLanding(dict);
    expect(screen.getByText(headline)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: cta })).toBeInTheDocument();
  });
});
