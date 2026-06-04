/**
 * Tests for the hero's power-user / returning-visitor accelerators.
 *
 * AC coverage:
 *   - Happy: "/" keyboard shortcut focuses the search field -> unit
 *   - Boundary: "/" does not steal focus while the user types in a field -> unit
 *   - Happy: a returning visitor sees a "continue where you left off" link -> integration
 *   - Null: no resume link when there is no stored route -> unit
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import HeroIntro from "@/components/auth/HeroIntro";
import { storeRecentRoute } from "@/hooks/useRecentRoute";

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

import { useDict } from "@/lib/i18n-context";

const jaFull = jaDict as unknown as Dict;
const t = jaDict.landing_hero.landing;

function renderHero() {
  vi.mocked(useDict).mockReturnValue(jaFull);
  render(<HeroIntro onSearch={vi.fn()} onChip={vi.fn()} />);
  return { input: screen.getByLabelText(t.search_placeholder) };
}

beforeEach(() => {
  vi.mocked(useDict).mockReturnValue(jaFull);
  localStorage.clear();
});
afterEach(() => localStorage.clear());

describe("HeroIntro — accelerators", () => {
  it("focuses the search field when '/' is pressed", () => {
    const { input } = renderHero();
    expect(input).not.toHaveFocus();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(input).toHaveFocus();
  });

  it("does not hijack '/' while the user is typing in a field", () => {
    const { input } = renderHero();
    input.focus();
    fireEvent.keyDown(input, { key: "/" });
    expect(input).toHaveFocus();
  });

  it("shows no resume link when there is no stored route", () => {
    renderHero();
    expect(screen.queryByTestId("hero-continue")).not.toBeInTheDocument();
  });

  it("shows a continue link for a stored route", () => {
    storeRecentRoute({ bangumiId: "160209", title: "君の名は。" });
    renderHero();
    const link = screen.getByTestId("hero-continue");
    expect(link).toHaveAttribute("href", "/anime/160209");
    expect(link).toHaveTextContent("君の名は。");
  });
});
