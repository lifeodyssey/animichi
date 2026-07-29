/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMagicLink } from "../../src/lib/auth/neonAuth";
import { LoginForm } from "../../src/components/auth/LoginForm";
import { renderWithLocale, setLanguages } from "./_i18n";

vi.mock("../../src/lib/auth/neonAuth", () => ({ sendMagicLink: vi.fn() }));
const send = vi.mocked(sendMagicLink);

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function submitWith(email: string): void {
  renderWithLocale(<LoginForm />);
  fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }));
}

describe("LoginForm validation", () => {
  it("blocks an empty email with an inline message and sends no request", () => {
    submitWith("   ");
    expect(screen.getByRole("alert").textContent).toContain("メールアドレスを入力");
    expect(send).not.toHaveBeenCalled();
  });

  it("blocks an address with no @ and sends no request", () => {
    submitWith("not-an-email");
    expect(screen.getByRole("alert").textContent).toContain("@");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("LoginForm submission", () => {
  it("sends a magic link and shows the sent confirmation", async () => {
    send.mockResolvedValue("sent");
    submitWith("Fan@Example.com ");
    await waitFor(() => { expect(screen.getByRole("status")).toBeTruthy(); });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ email: "fan@example.com" }),
    );
  });

  it("shows on-brand error copy when the request fails", async () => {
    send.mockResolvedValue("error");
    submitWith("fan@example.com");
    await waitFor(() => { expect(screen.getByRole("alert").textContent).toContain("もう一度"); });
  });

  it("shows a not-configured message when auth is unset", async () => {
    send.mockResolvedValue("not_configured");
    submitWith("fan@example.com");
    await waitFor(() => { expect(screen.getByRole("alert").textContent).toContain("管理者"); });
  });

  it("shows a submitting state while the request is pending", async () => {
    let resolve!: (value: "sent") => void;
    send.mockReturnValue(new Promise((r) => { resolve = r; }));
    submitWith("fan@example.com");
    await waitFor(() => { expect(screen.getByRole("button", { name: "送信中…" })).toBeTruthy(); });
    resolve("sent");
  });
});

/**
 * Issue #437 / #465: the notification used to fire from a passive effect, so it
 * landed a scheduler tick *after* the "sent" banner reached the DOM. A caller
 * that waits on the banner and then acts (the P5 save wall's dismissal) could
 * run before it was told — a 1-in-6 flake under load, and the same race a fast
 * human click would hit. The invariant asserted here is an **ordering** one:
 * the caller is never told later than the banner is observable.
 */
describe("LoginForm send-committed notification timing", () => {
  function submitLogin(onSendCommitted: () => void): void {
    renderWithLocale(<LoginForm onSendCommitted={onSendCommitted} />);
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "fan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }));
  }

  it("fires before any feedback banner is observable", () => {
    const seenBanner: (Element | null)[] = [];
    send.mockResolvedValue("sent");
    submitLogin(() => { seenBanner.push(screen.queryByRole("status"), screen.queryByRole("alert")); });
    expect(seenBanner).toEqual([null, null]);
  });

  it("has already fired by the time the sent banner renders", async () => {
    const onSendCommitted = vi.fn();
    send.mockResolvedValue("sent");
    submitLogin(onSendCommitted);
    await waitFor(() => { expect(screen.getByRole("status")).toBeTruthy(); });
    expect(onSendCommitted).toHaveBeenCalledTimes(1);
  });

  // The commitment is the click, not the reply: a caller keying dismissal off
  // this must not have a window the width of the request's latency.
  it("fires while the request is still in flight", () => {
    const onSendCommitted = vi.fn();
    send.mockReturnValue(new Promise(() => undefined));
    submitLogin(onSendCommitted);
    expect(onSendCommitted).toHaveBeenCalledTimes(1);
  });

  it("never fires for input the form rejects before dispatching", () => {
    const onSendCommitted = vi.fn();
    renderWithLocale(<LoginForm onSendCommitted={onSendCommitted} />);
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }));
    expect(onSendCommitted).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
