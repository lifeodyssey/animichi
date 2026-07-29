/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../../../src/features/chat/components/ChatInput";
import { QUOTA_BANNER_ID } from "../../../src/features/chat/components/ErrorStates/QuotaExhausted";
import { chatDictFor } from "../../../src/features/chat/i18n";

const ja = chatDictFor("ja");
const DRAFT = "宇治にいきたい";
const DRAFT_KEY = "animichi:chat-draft";

beforeEach(() => { sessionStorage.clear(); });
afterEach(cleanup);

function field(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox");
}

function typeDraft(): void {
  fireEvent.change(field(), { target: { value: DRAFT } });
}

describe("ChatInput under a D12 quota lock", () => {
  it("withholds the send button while the field keeps the visitor's draft", () => {
    const onSend = vi.fn();
    const view = render(<ChatInput dict={ja} disabled={false} onSend={onSend} />);
    typeDraft();
    view.rerender(<ChatInput dict={ja} disabled={false} quotaLocked onSend={onSend} />);
    expect(field().value).toBe(DRAFT);
    expect(screen.getByRole("button", { name: ja.send }).hasAttribute("disabled")).toBe(true);
  });

  it("swallows a submit so the draft survives an Enter press", () => {
    const onSend = vi.fn();
    render(<ChatInput dict={ja} disabled={false} quotaLocked onSend={onSend} />);
    typeDraft();
    fireEvent.submit(field());
    expect(onSend).not.toHaveBeenCalled();
    expect(field().value).toBe(DRAFT);
  });

  it("explains the lock in the placeholder and restores the ordinary copy after", () => {
    const onSend = vi.fn();
    const view = render(<ChatInput dict={ja} disabled={false} quotaLocked onSend={onSend} />);
    expect(field().placeholder).toBe(ja.errorStates.d12InputHint);
    view.rerender(<ChatInput dict={ja} disabled={false} onSend={onSend} />);
    expect(field().placeholder).toBe(ja.inputPlaceholder);
  });

  it("keeps its accessible name stable and moves the reason into a description", () => {
    const onSend = vi.fn();
    const view = render(<ChatInput dict={ja} disabled={false} quotaLocked onSend={onSend} />);
    expect(field().getAttribute("aria-label")).toBe(ja.inputPlaceholder);
    expect(field().getAttribute("aria-describedby")).toBe(QUOTA_BANNER_ID);
    view.rerender(<ChatInput dict={ja} disabled={false} onSend={onSend} />);
    expect(field().getAttribute("aria-describedby")).toBeNull();
  });

  it("sends the preserved draft once the lock lifts, with nothing retyped", () => {
    const onSend = vi.fn();
    const view = render(<ChatInput dict={ja} disabled={false} quotaLocked onSend={onSend} />);
    typeDraft();
    view.rerender(<ChatInput dict={ja} disabled={false} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: ja.send }));
    expect(onSend).toHaveBeenCalledWith(DRAFT);
  });
});

describe("draft persistence across the login round-trip", () => {
  it("parks the draft and clears it once the message is actually sent", () => {
    render(<ChatInput dict={ja} disabled={false} onSend={vi.fn()} />);
    typeDraft();
    expect(sessionStorage.getItem(DRAFT_KEY)).toBe(DRAFT);
    fireEvent.click(screen.getByRole("button", { name: ja.send }));
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("rehydrates a parked draft on mount, the way a magic-link return does", () => {
    sessionStorage.setItem(DRAFT_KEY, DRAFT);
    render(<ChatInput dict={ja} disabled={false} onSend={vi.fn()} />);
    expect(field().value).toBe(DRAFT);
  });

  it("still composes when session storage throws, as it does in private mode", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() { throw new Error("access denied"); },
    });
    try {
      const onSend = vi.fn();
      render(<ChatInput dict={ja} disabled={false} onSend={onSend} />);
      typeDraft();
      fireEvent.click(screen.getByRole("button", { name: ja.send }));
      expect(onSend).toHaveBeenCalledWith(DRAFT);
    } finally {
      if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    }
  });
});
