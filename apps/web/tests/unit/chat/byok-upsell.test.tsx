/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMagicLink } from "../../../src/lib/auth/neonAuth";
import { ByokUpsell } from "../../../src/features/chat/components/ByokUpsell";
import { BudgetExhausted } from "../../../src/features/chat/components/ErrorStates/BudgetExhausted";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { renderWithLocale, setLanguages } from "../_i18n";

vi.mock("../../../src/lib/auth/neonAuth", () => ({ sendMagicLink: vi.fn() }));
const send = vi.mocked(sendMagicLink);

const dict = chatDictFor("ja");

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ByokUpsell — value explainer (T8-AC2)", () => {
  it("states the benefit, browser-only key handling, and the account requirement", () => {
    renderWithLocale(<ByokUpsell dict={dict} />);
    expect(screen.getByText(dict.byok.upsellBenefit)).toBeTruthy();
    expect(screen.getByText(dict.byok.upsellPrivacy)).toBeTruthy();
    expect(screen.getByText(dict.byok.upsellAccount)).toBeTruthy();
  });

  it("opens the login modal as its primary action, deep-linking back to the panel", () => {
    send.mockResolvedValue("sent");
    renderWithLocale(<ByokUpsell dict={dict} />);
    fireEvent.click(screen.getByRole("button", { name: dict.byok.signInToSetUp }));
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "fan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      callbackURL: "http://localhost:3000/auth/callback?next=%2Fchat%3Fsettings%3Dbyok",
    }));
  });
});

describe("ByokUpsell — login modal lifecycle", () => {
  it("closes the login modal again without losing the explainer", () => {
    renderWithLocale(<ByokUpsell dict={dict} />);
    fireEvent.click(screen.getByRole("button", { name: dict.byok.signInToSetUp }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(dict.byok.upsellBenefit)).toBeTruthy();
  });
});

describe("BudgetExhausted (D11) — BYOK secondary affordance (T8-AC1)", () => {
  it("offers both the existing sign-in action and a distinct use-your-own-key action", () => {
    renderWithLocale(<BudgetExhausted dict={dict} />);
    expect(screen.getByRole("button", { name: dict.errorStates.d11Login })).toBeTruthy();
    expect(screen.getByRole("button", { name: dict.byok.d11UseOwnKey })).toBeTruthy();
  });

  it("opens the value explainer — not a login form — from the secondary action", () => {
    renderWithLocale(<BudgetExhausted dict={dict} />);
    fireEvent.click(screen.getByRole("button", { name: dict.byok.d11UseOwnKey }));
    expect(screen.getByText(dict.byok.upsellBenefit)).toBeTruthy();
    expect(screen.queryByLabelText("メールアドレス")).toBeNull();
  });

  it("renders no explainer until the secondary action is chosen", () => {
    renderWithLocale(<BudgetExhausted dict={dict} />);
    expect(screen.queryByText(dict.byok.upsellBenefit)).toBeNull();
  });
});
