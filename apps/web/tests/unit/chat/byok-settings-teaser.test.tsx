/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMagicLink } from "../../../src/lib/auth/neonAuth";
import { ByokSettings } from "../../../src/features/chat/components/ByokSettings";
import { getByokConfig, saveByokConfig } from "../../../src/lib/byok/byokStorage";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { renderWithLocale, setLanguages } from "../_i18n";

vi.mock("../../../src/lib/auth/neonAuth", () => ({ sendMagicLink: vi.fn() }));
const send = vi.mocked(sendMagicLink);

const dict = chatDictFor("ja");

function renderTeaser(): void {
  renderWithLocale(<ByokSettings dict={dict} auth="anonymous" baseUrl="http://agent.test" />);
}

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("ByokSettings — anonymous teaser (T8-AC3, touchpoint B)", () => {
  it("renders the value proposition and the sign-in CTA", () => {
    renderTeaser();
    expect(screen.getByText(dict.byok.anonymousTeaser)).toBeTruthy();
    expect(screen.getByRole("button", { name: dict.byok.signInToSetUp })).toBeTruthy();
  });

  it("renders NO key input at all — nothing that would silently discard input", () => {
    renderTeaser();
    expect(screen.queryByLabelText(dict.byok.apiKeyLabel)).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByRole("button", { name: dict.byok.save })).toBeNull();
  });

  it("opens the login modal from the CTA with the BYOK deep-link return target", () => {
    send.mockResolvedValue("sent");
    renderTeaser();
    fireEvent.click(screen.getByRole("button", { name: dict.byok.signInToSetUp }));
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "fan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      callbackURL: "http://localhost:3000/auth/callback?next=%2Fchat%3Fsettings%3Dbyok",
    }));
  });
});

describe("ByokSettings — lapsed session still holding a credential (P1-1)", () => {
  function saveCredential(): void {
    saveByokConfig({ provider: "anthropic", apiKey: "sk-lapsed-key", model: "claude-sonnet-4-5" });
  }

  it("offers a clear entry in the teaser — login is never the price of deletion", () => {
    saveCredential();
    renderTeaser();
    expect(screen.getByText(dict.byok.maskedSummary)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: dict.byok.clear }));
    expect(getByokConfig()).toBeNull();
    expect(screen.queryByText(dict.byok.maskedSummary)).toBeNull();
  });

  it("still renders no key input while the stored credential is shown", () => {
    saveCredential();
    renderTeaser();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("shows no clear entry when nothing is stored", () => {
    renderTeaser();
    expect(screen.queryByRole("button", { name: dict.byok.clear })).toBeNull();
  });
});

describe("ByokSettings — pending auth", () => {
  it("renders neither the form nor the teaser while auth is still resolving", () => {
    renderWithLocale(<ByokSettings dict={dict} auth="pending" baseUrl="http://agent.test" />);
    expect(screen.queryByText(dict.byok.anonymousTeaser)).toBeNull();
    expect(screen.queryByLabelText(dict.byok.apiKeyLabel)).toBeNull();
  });
});
