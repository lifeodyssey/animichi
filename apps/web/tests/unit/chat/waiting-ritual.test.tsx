/** @vitest-environment jsdom */
import type { UIMessage } from "ai";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WaitingRitual } from "../../../src/features/chat/components/WaitingRitual";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { waitingCopy } from "../../../src/features/chat/waiting-copy";

const dict = chatDictFor("zh");
const copy = waitingCopy("zh");
const messages: readonly UIMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "ユーフォ" }] }];

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("WaitingRitual", () => {
  it("keeps one honest status instead of inferring progress or an anime quote", () => {
    const { container } = render(<WaitingRitual status="submitted" dict={dict} messages={messages} />);
    act(() => { vi.advanceTimersByTime(4200); });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByText(copy.label)).toBeTruthy();
    expect(screen.queryByText(dict.waitingSubtitle)).toBeNull();
    expect(screen.queryByText(copy.extended)).toBeNull();
    expect(container.querySelector("img, figure, blockquote")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("adds reassurance after 15 seconds without replacing the status line", () => {
    render(<WaitingRitual status="submitted" dict={dict} messages={messages} />);
    act(() => { vi.advanceTimersByTime(14_999); });
    expect(screen.queryByText(copy.extended)).toBeNull();
    const status = screen.getByRole("status");
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toContain(copy.extended);
    expect(screen.getByText(copy.label)).toBeTruthy();
    expect(status.getAttribute("aria-atomic")).toBe("true");
  });

  it.each(["streaming", "ready", "error"] as const)("removes waiting and its timer when the turn becomes %s", (status) => {
    const view = render(<WaitingRitual status="submitted" dict={dict} messages={messages} />);
    act(() => { vi.advanceTimersByTime(15_000); });
    view.rerender(<WaitingRitual status={status} dict={dict} messages={messages} />);
    expect(view.container.innerHTML).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

});

describe("waiting across turns", () => {
  it("starts a fresh wait when a new user turn arrives while submitted", () => {
    const view = render(<WaitingRitual status="submitted" dict={dict} messages={messages} />);
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(screen.getByText(copy.extended)).toBeTruthy();
    const next: readonly UIMessage[] = [...messages, { id: "u2", role: "user", parts: [{ type: "text", text: "换成东京半天" }] }];
    view.rerender(<WaitingRitual status="submitted" dict={dict} messages={next} />);
    expect(screen.queryByText(copy.extended)).toBeNull();
    act(() => { vi.advanceTimersByTime(14_999); });
    expect(screen.queryByText(copy.extended)).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByText(copy.extended)).toBeTruthy();
  });

  it("keeps elapsed waiting when message data refreshes for the same user turn", () => {
    const view = render(<WaitingRitual status="submitted" dict={dict} messages={messages} />);
    act(() => { vi.advanceTimersByTime(10_000); });
    const refreshed: readonly UIMessage[] = [...messages, { id: "a1", role: "assistant", parts: [] }];
    view.rerender(<WaitingRitual status="submitted" dict={dict} messages={refreshed} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText(copy.extended)).toBeTruthy();
  });

  it("does not carry a long wait into a retry of the same message", () => {
    const view = render(<WaitingRitual status="submitted" dict={dict} messages={messages} />);
    act(() => { vi.advanceTimersByTime(15_000); });
    view.rerender(<WaitingRitual status="error" dict={dict} messages={messages} />);
    view.rerender(<WaitingRitual status="submitted" dict={dict} messages={messages} />);
    expect(screen.getByText(copy.label)).toBeTruthy();
    expect(screen.queryByText(copy.extended)).toBeNull();
  });

  it("works before user-message data is available", () => {
    render(<WaitingRitual status="submitted" dict={dict} messages={[]} />);
    expect(screen.getByText(copy.label)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(screen.getByText(copy.extended)).toBeTruthy();
  });

  it("releases the waiting timer on unmount", () => {
    const view = render(<WaitingRitual status="submitted" dict={dict} messages={messages} />);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
