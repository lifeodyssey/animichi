/**
 * @vitest-environment jsdom
 */
import type { UIMessage } from "ai";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WaitingRitual } from "../../../src/features/chat/components/WaitingRitual";
import { chatDictFor } from "../../../src/features/chat/i18n";

const ja = chatDictFor("ja");

function userMessage(text: string): UIMessage {
  return { id: "u1", role: "user", parts: [{ type: "text", text }] };
}

function renderRitual(text = "ユーフォ") {
  return render(<WaitingRitual status="submitted" dict={ja} messages={[userMessage(text)]} />);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("WaitingRitual escalation", () => {
  it("shows only the fox typing indicator under one second (B2a)", () => {
    renderRitual();
    expect(screen.getByRole("status", { name: ja.thinking })).toBeTruthy();
    expect(screen.queryByText(ja.waitingSubtitle)).toBeNull();
  });

  it("adds the first-person fox subtitle after one second (B2b)", () => {
    renderRitual();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByText(ja.waitingSubtitle)).toBeTruthy();
  });

  it("adds the mood card for a known title after four seconds (B2c)", () => {
    renderRitual();
    act(() => { vi.advanceTimersByTime(4200); });
    expect(screen.getByText("ここから、はじまるんだ。")).toBeTruthy();
  });

  it("keeps the mood card hidden for an untitled long wait", () => {
    renderRitual("近くの聖地");
    act(() => { vi.advanceTimersByTime(4200); });
    expect(screen.queryByRole("figure")).toBeNull();
  });

  it("skips the mood card when the pending turn has no user text to match", () => {
    const assistant: UIMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "…" }] };
    render(<WaitingRitual status="submitted" dict={ja} messages={[assistant]} />);
    act(() => { vi.advanceTimersByTime(4200); });
    expect(screen.queryByRole("figure")).toBeNull();
  });

  it("ignores non-text parts when reading the pending user title", () => {
    const parts = [{ type: "step-start" }, { type: "text", text: "ユーフォ" }];
    const mixed = { id: "u9", role: "user", parts } as unknown as UIMessage;
    render(<WaitingRitual status="submitted" dict={ja} messages={[mixed]} />);
    act(() => { vi.advanceTimersByTime(4200); });
    expect(screen.getByText("ここから、はじまるんだ。")).toBeTruthy();
  });

  it("renders nothing once the turn is no longer submitted", () => {
    const { container } = render(
      <WaitingRitual status="streaming" dict={ja} messages={[userMessage("ユーフォ")]} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
