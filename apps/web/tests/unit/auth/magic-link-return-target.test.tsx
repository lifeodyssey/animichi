/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMagicLink } from "../../../src/lib/auth/neonAuth";
import { LoginModal } from "../../../src/components/auth/LoginModal";
import { renderWithLocale, setLanguages } from "../_i18n";

vi.mock("../../../src/lib/auth/neonAuth", () => ({ sendMagicLink: vi.fn() }));
const send = vi.mocked(sendMagicLink);

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function submitLogin(returnTarget?: string): void {
  send.mockResolvedValue("sent");
  renderWithLocale(<LoginModal open onClose={() => undefined} returnTarget={returnTarget} />);
  fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "fan@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }));
}

function expectSentCallbackUrl(callbackURL: string): void {
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ callbackURL }));
}

/**
 * T8 constraint 1: the BYOK setup intent must ride in the magic-link callback
 * URL — the link may open in a fresh tab where per-tab storage is empty. And
 * normatively (spec P2-4): `callbackURL` is always `${origin}/auth/callback`
 * with an already-validated relative `next` appended — never a caller-supplied
 * absolute URL, or the open redirect moves up into the auth provider.
 */
describe("magic-link callback URL return target", () => {
  it("appends a validated relative next to the fixed callback path", () => {
    submitLogin("/chat?settings=byok");
    expectSentCallbackUrl("http://localhost:3000/auth/callback?next=%2Fchat%3Fsettings%3Dbyok");
  });

  it("sends the bare callback URL when no return target was given", () => {
    submitLogin();
    expectSentCallbackUrl("http://localhost:3000/auth/callback");
  });

  it.each(["https://evil.test/", "//evil.test", "/\\evil.test"])(
    "never forwards the T14 vector %j into the mailed link",
    (vector) => {
      submitLogin(vector);
      expectSentCallbackUrl("http://localhost:3000/auth/callback");
    },
  );

  it("elides a redundant next pointing at the home fallback", () => {
    submitLogin("/");
    expectSentCallbackUrl("http://localhost:3000/auth/callback");
  });
});
