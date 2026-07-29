/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTurnClock } from "../../../src/features/chat/use-turn-clock";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTurnClock", () => {
  it("stays at zero while the turn is inactive", () => {
    const { result } = renderHook(() => useTurnClock(false));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(0);
  });

  it("accumulates elapsed milliseconds while the turn is active", () => {
    const { result } = renderHook(() => useTurnClock(true));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current).toBeGreaterThanOrEqual(2000);
  });

  it("resets to zero once the turn goes inactive again", () => {
    const { rerender, result } = renderHook(({ active }) => useTurnClock(active), {
      initialProps: { active: true },
    });
    act(() => { vi.advanceTimersByTime(2000); });
    rerender({ active: false });
    expect(result.current).toBe(0);
  });
});
