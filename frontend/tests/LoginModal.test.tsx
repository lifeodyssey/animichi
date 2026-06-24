/**
 * Tests for LoginModal + the LoginForm magic-link flow it hosts.
 *
 * AC coverage:
 *   - Happy: backdrop / X close the modal; inner clicks do not -> unit
 *   - Happy: submitting an email sends the magic link and shows the
 *     check-your-email screen; "back" returns to the form -> integration
 *   - Error: a Supabase error surfaces as an inline alert -> unit
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import jaDict from "@/lib/dictionaries/ja.json";

const signInWithOtp = vi.fn();

vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(() => jaDict),
  useLocale: vi.fn(() => "ja"),
  useSetLocale: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/supabase/browser", () => ({
  createClient: vi.fn(() => ({ auth: { signInWithOtp } })),
}));

vi.mock("@/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>();
  return { ...actual, detectLocale: vi.fn(() => "ja") };
});

import LoginModal from "@/components/auth/LoginModal";

const t = jaDict.auth;

function renderModal(onClose = vi.fn()) {
  render(<LoginModal redirect="/" onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  signInWithOtp.mockReset();
  signInWithOtp.mockResolvedValue({ error: null });
});

describe("LoginModal — dismissal", () => {
  it("closes when the backdrop is clicked", () => {
    const onClose = renderModal();
    const backdrop = screen.getByRole("dialog").parentElement;
    if (!backdrop) throw new Error("dialog has no parent backdrop");
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when the dialog body is clicked", () => {
    const onClose = renderModal();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from the X button", () => {
    const onClose = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("LoginModal — magic-link flow", () => {
  it("sends the magic link and shows the check-your-email screen", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(t.email_label), {
      target: { value: "  Tabi@Example.COM " },
    });
    fireEvent.click(screen.getByRole("button", { name: t.btn_login }));

    expect(await screen.findByText(t.check_email_heading)).toBeInTheDocument();
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "tabi@example.com" }),
    );
  });

  it("returns to the form from the back link", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(t.email_label), {
      target: { value: "tabi@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: t.btn_login }));
    fireEvent.click(await screen.findByText(t.back_to_login));

    expect(screen.getByLabelText(t.email_label)).toBeInTheDocument();
  });

  it("surfaces a Supabase error as an inline alert", async () => {
    signInWithOtp.mockResolvedValue({ error: { message: "rate limited" } });
    renderModal();
    fireEvent.change(screen.getByLabelText(t.email_label), {
      target: { value: "tabi@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: t.btn_login }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t.error.replace("{message}", "rate limited"));
  });
});
