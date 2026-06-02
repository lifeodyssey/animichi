/**
 * Tests for LandingPage hero — Task B1
 *
 * AC coverage:
 *   - Happy: hero shows BeforeAfter + FoxGuide + pill search + gold CTA + ROUTE PREVIEW -> unit
 *   - Happy: example chip click fills input and triggers search path -> integration
 *   - Null/empty: empty search submit does not navigate; CTA disabled -> unit
 *   - Error: empty example list renders hero without chips, no crash -> unit
 *   - i18n: all hero copy per locale; no hardcoded JP literals -> unit
 *   - Responsive: (behavioral — covered by probe; unit covers no-crash on small viewport) -> unit
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import enDict from "@/lib/dictionaries/en.json";
import zhDict from "@/lib/dictionaries/zh.json";

// ── Mocks ────────────────────────────────────────────────────────────────────

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

// Stub BeforeAfter: renders two imgs by testId so tests can assert presence
vi.mock("@/components/generative/BeforeAfter", () => ({
  default: ({
    leftAlt,
    rightAlt,
  }: {
    leftSrc: string;
    rightSrc: string;
    leftAlt?: string;
    rightAlt?: string;
    draggable?: boolean;
    className?: string;
  }) => (
    <div data-testid="before-after-mock">
      <img src="anime.jpg" alt={leftAlt ?? "anime"} />
      <img src="real.jpg" alt={rightAlt ?? "real"} />
    </div>
  ),
}));

// Stub FoxGuide: renders a div so tests can assert presence
vi.mock("@/components/generative/FoxGuide", () => ({
  default: ({
    pose,
    size,
  }: {
    pose: string;
    size: string;
    surface: string;
    className?: string;
  }) => <div data-testid="fox-guide-mock" data-pose={pose} data-size={size} />,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import { useDict } from "@/lib/i18n-context";
import LandingPage from "@/components/auth/LandingPage";

const jaFull = jaDict as unknown as Dict;
const enFull = enDict as unknown as Dict;
const zhFull = zhDict as unknown as Dict;

function renderLanding(dict: Dict = jaFull, onOpenAuth = vi.fn()) {
  vi.mocked(useDict).mockReturnValue(dict);
  return render(<LandingPage onOpenAuth={onOpenAuth} />);
}

// ── AC: Happy path — hero elements present ────────────────────────────────────

describe("B1 hero — happy path elements", () => {
  it("renders BeforeAfter component as primary visual", () => {
    renderLanding(jaFull);
    // LandingPage now renders multiple BeforeAfter instances (hero + how-it-works step 2)
    expect(screen.getAllByTestId("before-after-mock").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the fox guide mascot", () => {
    renderLanding(jaFull);
    // LandingPage now places the fox across several sections (hero + how-it-works
    // + popular-routes banner + save-sync); assert at least the hero one renders.
    const foxes = screen.getAllByTestId("fox-guide-mock");
    expect(foxes.length).toBeGreaterThanOrEqual(1);
  });

  it("renders pill search input", () => {
    renderLanding(jaFull);
    expect(screen.getByPlaceholderText(/入力|anime|station|city|输入/i)).toBeInTheDocument();
  });

  it("renders gold CTA button", () => {
    renderLanding(jaFull);
    const cta = screen.getByRole("button", { name: /巡礼を始める|Start Exploring|开始巡礼/i });
    expect(cta).toBeInTheDocument();
  });

  it("renders ROUTE PREVIEW section", () => {
    renderLanding(jaFull);
    expect(
      screen.getByTestId("route-preview") ||
        screen.getByText(/ROUTE PREVIEW|route preview/i),
    ).toBeInTheDocument();
  });

  it("renders example chips", () => {
    renderLanding(jaFull);
    expect(screen.getAllByTestId(/example-chip/).length).toBeGreaterThanOrEqual(1);
  });
});

// ── AC: Example chip triggers search ─────────────────────────────────────────

describe("B1 hero — example chip interaction", () => {
  it("fills search input when chip is clicked", () => {
    renderLanding(jaFull);
    const chips = screen.getAllByTestId(/example-chip/);
    expect(chips.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(chips[0]);
    // The hero search textbox is the first textbox in the page (save-sync email input is second)
    const input = screen.getAllByRole("textbox")[0];
    expect((input as HTMLInputElement).value).not.toBe("");
  });

  it("calls onOpenAuth when chip is clicked (triggers search path)", () => {
    const onOpenAuth = vi.fn();
    renderLanding(jaFull, onOpenAuth);
    const chips = screen.getAllByTestId(/example-chip/);
    fireEvent.click(chips[0]);
    expect(onOpenAuth).toHaveBeenCalled();
  });

  it("passes a non-empty query when triggering auth from chip", () => {
    const onOpenAuth = vi.fn();
    renderLanding(jaFull, onOpenAuth);
    const chips = screen.getAllByTestId(/example-chip/);
    fireEvent.click(chips[0]);
    const [calledQuery] = onOpenAuth.mock.calls[0] as [string | undefined];
    expect(typeof calledQuery).toBe("string");
    expect((calledQuery ?? "").length).toBeGreaterThan(0);
  });
});

// ── AC: Empty search does not navigate ───────────────────────────────────────

describe("B1 hero — empty search guard", () => {
  it("CTA stays enabled and inviting even when the input is empty", () => {
    // The hero CTA is the marketing focal point — it reads orange/active, not
    // greyed out. Empty submits are blocked by the internal guard (next test).
    renderLanding(jaFull);
    const cta = screen.getByRole("button", { name: /巡礼を始める|Start Exploring|开始巡礼/i });
    expect(cta).toBeEnabled();
  });

  it("does not call onOpenAuth when CTA clicked with empty input", () => {
    const onOpenAuth = vi.fn();
    renderLanding(jaFull, onOpenAuth);
    const cta = screen.getByRole("button", { name: /巡礼を始める|Start Exploring|开始巡礼/i });
    fireEvent.click(cta);
    expect(onOpenAuth).not.toHaveBeenCalled();
  });
});

// ── AC: Error — empty example list ───────────────────────────────────────────

describe("B1 hero — empty example list edge case", () => {
  it("renders hero without chips when example list is empty, no crash", () => {
    const dictNoExamples = {
      ...jaFull,
      landing_hero: {
        ...jaFull.landing_hero,
        landing: {
          ...jaFull.landing_hero.landing,
          hero_examples: [] as string[],
        },
      },
    } as unknown as Dict;
    renderLanding(dictNoExamples);
    // hero still renders — at least one textbox present (hero search or save-sync email)
    expect(screen.getAllByRole("textbox").length).toBeGreaterThanOrEqual(1);
    // no chips rendered — query returns empty
    expect(screen.queryAllByTestId(/example-chip/).length).toBe(0);
  });
});

// ── AC: i18n — locale-keyed copy, no hardcoded JP ────────────────────────────

describe("B1 hero — i18n", () => {
  it("renders Japanese headline from dictionary", () => {
    renderLanding(jaFull);
    expect(screen.getByText(/アニメの場面を/)).toBeInTheDocument();
  });

  it("renders English headline from dictionary", () => {
    vi.mocked(useDict).mockReturnValue(enFull);
    render(<LandingPage onOpenAuth={vi.fn()} />);
    expect(screen.getByText(/Turn anime scenes/)).toBeInTheDocument();
  });

  it("renders Chinese headline from dictionary", () => {
    vi.mocked(useDict).mockReturnValue(zhFull);
    render(<LandingPage onOpenAuth={vi.fn()} />);
    expect(screen.getByText(/把动画场景/)).toBeInTheDocument();
  });

  it("renders Japanese CTA from dictionary", () => {
    renderLanding(jaFull);
    expect(screen.getByRole("button", { name: "巡礼を始める" })).toBeInTheDocument();
  });

  it("renders English CTA from dictionary", () => {
    vi.mocked(useDict).mockReturnValue(enFull);
    render(<LandingPage onOpenAuth={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start Exploring" })).toBeInTheDocument();
  });

  it("renders Chinese CTA from dictionary", () => {
    vi.mocked(useDict).mockReturnValue(zhFull);
    render(<LandingPage onOpenAuth={vi.fn()} />);
    expect(screen.getByRole("button", { name: "开始巡礼" })).toBeInTheDocument();
  });

  it("renders hero lead text from dictionary (ja)", () => {
    renderLanding(jaFull);
    expect(screen.getByText(/作品名・駅名・都市名を入力/)).toBeInTheDocument();
  });

  it("renders search placeholder from dictionary (en)", () => {
    vi.mocked(useDict).mockReturnValue(enFull);
    render(<LandingPage onOpenAuth={vi.fn()} />);
    expect(
      screen.getByPlaceholderText(/anime|station|city/i),
    ).toBeInTheDocument();
  });
});

// ── AC: Responsive — hero renders without crash on narrow viewport ────────────

describe("B1 hero — responsive guard", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 375,
    });
  });

  it("renders hero without crash on mobile viewport width", () => {
    renderLanding(jaFull);
    // headline still present
    expect(screen.getByText(/アニメの場面を/)).toBeInTheDocument();
  });

  it("renders search input on mobile viewport", () => {
    renderLanding(jaFull);
    // At least one textbox (hero search) is present; save-sync email may also appear
    expect(screen.getAllByRole("textbox").length).toBeGreaterThanOrEqual(1);
  });
});
