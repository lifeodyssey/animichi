/**
 * Tests for Task B3 — "Save-sync" section + 4-section homepage assembly
 *
 * AC coverage:
 *   - Happy: save-sync section renders; full page single-scroll with consistent header/footer -> browser/render
 *   - Boundary: scroll-reveal animations respect prefers-reduced-motion (content visible) -> unit
 *   - Error: unauthenticated CTA click opens login modal (no crash, no dead link) -> integration
 *   - i18n: save-sync copy localized for ja/en/zh -> unit
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import enDict from "@/lib/dictionaries/en.json";
import zhDict from "@/lib/dictionaries/zh.json";
import { LandingSaveSync } from "@/components/auth/LandingSaveSync";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(),
  useLocale: vi.fn(() => "ja" as const),
  useSetLocale: vi.fn(() => vi.fn()),
}));

vi.mock("@/hooks/useScrollReveal", () => ({
  useScrollReveal: vi.fn(() => vi.fn()),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { useDict } from "@/lib/i18n-context";

const jaFull = jaDict as unknown as Dict;
const enFull = enDict as unknown as Dict;
const zhFull = zhDict as unknown as Dict;

function renderSaveSync(dict: Dict = jaFull, onOpenAuth = vi.fn()) {
  vi.mocked(useDict).mockReturnValue(dict);
  return render(<LandingSaveSync onOpenAuth={onOpenAuth} />);
}

// ── AC: Happy — save-sync section renders ─────────────────────────────────────

describe("LandingSaveSync — happy path", () => {
  beforeEach(() => {
    vi.mocked(useDict).mockReturnValue(jaFull);
  });

  it("renders the section container", () => {
    renderSaveSync();
    expect(screen.getByTestId("save-sync-section")).toBeInTheDocument();
  });

  it("renders the headline from dictionary", () => {
    renderSaveSync();
    const t = jaDict.landing_hero.landing;
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(t.ss_title);
  });

  it("renders the subtitle from dictionary", () => {
    renderSaveSync();
    const t = jaDict.landing_hero.landing;
    expect(screen.getByText(t.ss_sub)).toBeInTheDocument();
  });

  it("renders all three feature bullets", () => {
    renderSaveSync();
    const t = jaDict.landing_hero.landing;
    expect(screen.getByText(t.ss_feature1)).toBeInTheDocument();
    expect(screen.getByText(t.ss_feature2)).toBeInTheDocument();
    expect(screen.getByText(t.ss_feature3)).toBeInTheDocument();
  });

  it("renders the magic-link card title", () => {
    renderSaveSync();
    const t = jaDict.landing_hero.landing;
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(t.ss_card_title);
  });

  it("renders the email input", () => {
    renderSaveSync();
    const t = jaDict.landing_hero.landing;
    expect(screen.getByPlaceholderText(t.ss_email_placeholder)).toBeInTheDocument();
  });

  it("renders the save CTA button", () => {
    renderSaveSync();
    expect(screen.getByTestId("ss-save-cta")).toBeInTheDocument();
  });

  it("renders the 'keep browsing' CTA", () => {
    renderSaveSync();
    expect(screen.getByTestId("ss-browse-cta")).toBeInTheDocument();
  });
});

// ── AC: Boundary — prefers-reduced-motion: content still visible ──────────────

describe("LandingSaveSync — reduced motion boundary", () => {
  it("seichi-reveal elements are present in DOM regardless of motion preference", () => {
    renderSaveSync();
    // The class seichi-reveal is applied; CSS handles visibility via opacity:1 !important
    const revealEls = document.querySelectorAll(".seichi-reveal, .seichi-reveal-pop");
    expect(revealEls.length).toBeGreaterThan(0);
  });

  it("section heading is always present (not behind JS gate)", () => {
    renderSaveSync();
    // Even without IntersectionObserver firing, the heading renders
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });

  it("feature bullets are always present (not conditionally rendered)", () => {
    renderSaveSync();
    const t = jaDict.landing_hero.landing;
    // All three must be present without scroll trigger
    expect(screen.getByText(t.ss_feature1)).toBeInTheDocument();
    expect(screen.getByText(t.ss_feature2)).toBeInTheDocument();
    expect(screen.getByText(t.ss_feature3)).toBeInTheDocument();
  });

  it("magic-link card is always present (not conditionally rendered)", () => {
    renderSaveSync();
    const t = jaDict.landing_hero.landing;
    expect(screen.getByRole("region", { name: t.ss_card_title })).toBeInTheDocument();
  });
});

// ── AC: Error — unauthenticated CTA click opens login modal ──────────────────

describe("LandingSaveSync — CTA opens login modal (integration)", () => {
  it("save CTA button calls onOpenAuth when clicked", () => {
    const onOpenAuth = vi.fn();
    renderSaveSync(jaFull, onOpenAuth);
    fireEvent.click(screen.getByTestId("ss-save-cta"));
    expect(onOpenAuth).toHaveBeenCalledTimes(1);
  });

  it("browse CTA button calls onOpenAuth when clicked", () => {
    const onOpenAuth = vi.fn();
    renderSaveSync(jaFull, onOpenAuth);
    fireEvent.click(screen.getByTestId("ss-browse-cta"));
    expect(onOpenAuth).toHaveBeenCalledTimes(1);
  });

  it("save CTA does not throw when clicked without email input", () => {
    const onOpenAuth = vi.fn();
    renderSaveSync(jaFull, onOpenAuth);
    expect(() => fireEvent.click(screen.getByTestId("ss-save-cta"))).not.toThrow();
  });

  it("form submission calls onOpenAuth (no crash)", () => {
    const onOpenAuth = vi.fn();
    renderSaveSync(jaFull, onOpenAuth);
    const form = screen.getByTestId("ss-save-cta").closest("form");
    if (form) fireEvent.submit(form);
    expect(onOpenAuth).toHaveBeenCalledTimes(1);
  });
});

// ── AC: i18n — save-sync copy localized ──────────────────────────────────────

describe("LandingSaveSync — i18n", () => {
  it("renders English headline from en dictionary", () => {
    renderSaveSync(enFull);
    const t = enDict.landing_hero.landing;
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(t.ss_title);
  });

  it("renders English save CTA text", () => {
    renderSaveSync(enFull);
    const t = enDict.landing_hero.landing;
    expect(screen.getByTestId("ss-save-cta")).toHaveTextContent(t.ss_save_cta);
  });

  it("renders Chinese headline from zh dictionary", () => {
    renderSaveSync(zhFull);
    const t = zhDict.landing_hero.landing;
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(t.ss_title);
  });

  it("renders Chinese feature bullets from zh dictionary", () => {
    renderSaveSync(zhFull);
    const t = zhDict.landing_hero.landing;
    expect(screen.getByText(t.ss_feature1)).toBeInTheDocument();
    expect(screen.getByText(t.ss_feature2)).toBeInTheDocument();
  });

  it("renders Japanese card title from ja dictionary", () => {
    renderSaveSync(jaFull);
    const t = jaDict.landing_hero.landing;
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(t.ss_card_title);
  });

  it("renders Japanese email placeholder from ja dictionary", () => {
    renderSaveSync(jaFull);
    const t = jaDict.landing_hero.landing;
    expect(screen.getByPlaceholderText(t.ss_email_placeholder)).toBeInTheDocument();
  });
});
