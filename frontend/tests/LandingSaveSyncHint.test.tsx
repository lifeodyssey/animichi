/**
 * Tests for the save-sync email teaser's advisory hint.
 *
 * AC coverage:
 *   - Happy: no hint before the user interacts with the field -> unit
 *   - Boundary: a well-formed email after blur shows no hint -> unit
 *   - Error: a malformed email after blur shows a non-blocking advisory hint -> unit
 *   - Error-recovery contract: the hint never blocks submit; "Save my route"
 *     still opens the auth modal even with a malformed email -> integration
 *   - i18n: the advisory copy is localized -> unit
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import enDict from "@/lib/dictionaries/en.json";
import { LandingSaveSync } from "@/components/auth/LandingSaveSync";

vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(),
  useLocale: vi.fn(() => "ja" as const),
  useSetLocale: vi.fn(() => vi.fn()),
}));

vi.mock("@/hooks/useScrollReveal", () => ({
  useScrollReveal: vi.fn(() => vi.fn()),
}));

import { useDict } from "@/lib/i18n-context";

const jaFull = jaDict as unknown as Dict;
const enFull = enDict as unknown as Dict;

function renderSaveSync(dict: Dict = jaFull, onOpenAuth = vi.fn()) {
  vi.mocked(useDict).mockReturnValue(dict);
  render(<LandingSaveSync onOpenAuth={onOpenAuth} />);
  return { onOpenAuth, email: screen.getByPlaceholderText(dict.landing_hero.landing.ss_email_placeholder) };
}

describe("LandingSaveSync — email advisory hint", () => {
  beforeEach(() => {
    vi.mocked(useDict).mockReturnValue(jaFull);
  });

  it("shows no hint before the user touches the field", () => {
    renderSaveSync();
    expect(screen.queryByText(jaFull.landing_hero.landing.ss_email_hint)).not.toBeInTheDocument();
  });

  it("shows no hint when a well-formed email is entered and blurred", () => {
    const { email } = renderSaveSync();
    fireEvent.change(email, { target: { value: "fan@example.com" } });
    fireEvent.blur(email);
    expect(screen.queryByText(jaFull.landing_hero.landing.ss_email_hint)).not.toBeInTheDocument();
  });

  it("shows the missing-@ advisory when the email has no @", () => {
    const { email } = renderSaveSync();
    fireEvent.change(email, { target: { value: "not-an-email" } });
    fireEvent.blur(email);
    expect(screen.getByRole("status")).toHaveTextContent(jaFull.landing_hero.landing.ss_email_hint_at);
  });

  it("shows the after-@ advisory when the domain is malformed", () => {
    const { email } = renderSaveSync();
    fireEvent.change(email, { target: { value: "a@b" } });
    fireEvent.blur(email);
    expect(screen.getByRole("status")).toHaveTextContent(jaFull.landing_hero.landing.ss_email_hint);
  });

  it("does not block submit: malformed email still opens the auth modal", () => {
    const { email, onOpenAuth } = renderSaveSync();
    fireEvent.change(email, { target: { value: "oops" } });
    fireEvent.blur(email);
    const form = screen.getByTestId("ss-save-cta").closest("form");
    if (form) fireEvent.submit(form);
    expect(onOpenAuth).toHaveBeenCalledTimes(1);
  });

  it("renders the advisory copy localized (en)", () => {
    const { email } = renderSaveSync(enFull);
    fireEvent.change(email, { target: { value: "bad" } });
    fireEvent.blur(email);
    expect(screen.getByRole("status")).toHaveTextContent(enFull.landing_hero.landing.ss_email_hint_at);
  });

  it("marks the field aria-invalid once a malformed email is blurred", () => {
    const { email } = renderSaveSync();
    fireEvent.change(email, { target: { value: "nope" } });
    fireEvent.blur(email);
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("renders the magic-link help trigger with localized copy", () => {
    renderSaveSync();
    expect(screen.getByTestId("ss-magiclink-trigger")).toHaveTextContent(
      jaFull.landing_hero.landing.ss_magiclink_q,
    );
  });
});
