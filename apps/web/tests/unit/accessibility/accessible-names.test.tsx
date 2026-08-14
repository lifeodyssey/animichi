/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LoginModal } from "../../../src/features/auth/ui/LoginModal";
import { ChatInput } from "../../../src/features/chat/components/ChatInput";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { chatDictFor } from "../../../src/features/chat/i18n";

afterEach(cleanup);

/**
 * WCAG 4.1.2 Name, Role, Value (renamed Accessible Name in 2.2): every
 * interactive control must carry an accessible name derived from its label
 * text or an explicit aria-label. This is the stable unit gate.
 */
describe("accessible names: login form", () => {
  it("labels the email field with the login label", () => {
    render(
      <LocaleProvider>
        <LoginModal open onClose={() => undefined} />
      </LocaleProvider>,
    );
    const email = screen.getByRole("textbox", { name: /メールアドレス|email|E-mail/i });
    expect(email).toBeTruthy();
  });

  it("names the modal dialog", () => {
    render(
      <LocaleProvider>
        <LoginModal open onClose={() => undefined} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    const dialog = screen.getByRole("dialog");
    expect((dialog.getAttribute("aria-label") ?? "").length).toBeGreaterThan(0);
  });

  it("names the close button", () => {
    render(
      <LocaleProvider>
        <LoginModal open onClose={() => undefined} />
      </LocaleProvider>,
    );
    const close = screen.getByRole("button", { name: /閉じる|close/i });
    expect(close).toBeTruthy();
  });
});

describe("accessible names: chat composer", () => {
  const ja = chatDictFor("ja");

  it("names the composer textbox and the send button", () => {
    render(
      <LocaleProvider>
        <ChatInput dict={ja} disabled={false} onSend={() => undefined} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("textbox", { name: ja.inputPlaceholder })).toBeTruthy();
    expect(screen.getByRole("button", { name: ja.send })).toBeTruthy();
  });

  it("keeps the accessible name when quota-locked and exposes it as a description", () => {
    render(
      <LocaleProvider>
        <ChatInput dict={ja} disabled={false} quotaLocked onSend={() => undefined} />
      </LocaleProvider>,
    );
    const textbox = screen.getByRole("textbox", { name: ja.inputPlaceholder });
    expect(textbox.getAttribute("aria-describedby")).toBeTruthy();
  });
});
