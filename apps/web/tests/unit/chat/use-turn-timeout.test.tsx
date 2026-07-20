/**
 * @vitest-environment jsdom
 */
import type { ChatStatus } from "ai";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TURN_TIMEOUT_MS, useTurnTimeout } from "../../../src/features/chat/use-turn-timeout";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function renderTimeout(stop: () => void, status: ChatStatus = "submitted") {
  return renderHook((props: { status: ChatStatus }) => useTurnTimeout(props.status, stop), {
    initialProps: { status },
  });
}

describe("useTurnTimeout (D5 watchdog)", () => {
  it("stays quiet when the turn settles inside the budget", () => {
    const stop = vi.fn();
    const view = renderTimeout(stop);
    act(() => { vi.advanceTimersByTime(TURN_TIMEOUT_MS - 1); });
    view.rerender({ status: "ready" });
    act(() => { vi.advanceTimersByTime(TURN_TIMEOUT_MS); });
    expect(stop).not.toHaveBeenCalled();
    expect(view.result.current.timedOut).toBe(false);
  });

  it("stops the turn and raises the flag once the 60s budget elapses", () => {
    const stop = vi.fn();
    const view = renderTimeout(stop);
    act(() => { vi.advanceTimersByTime(TURN_TIMEOUT_MS); });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(view.result.current.timedOut).toBe(true);
  });

  it("keeps a single watchdog across the submitted-to-streaming upgrade", () => {
    const stop = vi.fn();
    const view = renderTimeout(stop);
    act(() => { vi.advanceTimersByTime(TURN_TIMEOUT_MS / 2); });
    view.rerender({ status: "streaming" });
    act(() => { vi.advanceTimersByTime(TURN_TIMEOUT_MS / 2); });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("clears the flag when the next turn starts", () => {
    const view = renderTimeout(vi.fn());
    act(() => { vi.advanceTimersByTime(TURN_TIMEOUT_MS); });
    view.rerender({ status: "ready" });
    view.rerender({ status: "submitted" });
    expect(view.result.current.timedOut).toBe(false);
  });

  it("resets on demand for the retry flow", () => {
    const view = renderTimeout(vi.fn());
    act(() => { vi.advanceTimersByTime(TURN_TIMEOUT_MS); });
    act(() => { view.result.current.reset(); });
    expect(view.result.current.timedOut).toBe(false);
  });
});
