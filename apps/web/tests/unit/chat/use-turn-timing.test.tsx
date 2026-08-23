/**
 * @vitest-environment jsdom
 */
import type { ChatStatus } from "ai";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTurnTiming } from "../../../src/features/chat/use-turn-timing";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderTiming(report: (kind: string, ms: number) => void) {
  const wrapped = ({ kind, ms }: { kind: string; ms: number }) => {
    report(kind, ms);
  };
  return renderHook(({ status, events }: { status: ChatStatus; events: number }) => useTurnTiming(status, events, wrapped), {
    initialProps: { status: "ready" as ChatStatus, events: 3 },
  });
}

describe("useTurnTiming", () => {
  it("reports first-token latency on the first visible business event", () => {
    const report = vi.fn();
    const { rerender } = renderTiming(report);
    rerender({ status: "submitted", events: 3 });
    vi.advanceTimersByTime(1200);
    rerender({ status: "streaming", events: 4 });
    expect(report).toHaveBeenCalledWith("first_token", 1200);
  });

  it("reports and returns the total turn duration once settled", () => {
    const report = vi.fn();
    const { rerender, result } = renderTiming(report);
    rerender({ status: "submitted", events: 3 });
    vi.advanceTimersByTime(800);
    rerender({ status: "streaming", events: 4 });
    vi.advanceTimersByTime(8400);
    rerender({ status: "ready", events: 4 });
    expect(report).toHaveBeenCalledWith("turn", 9200);
    expect(result.current).toBe(9200);
  });

  it("does not count protocol-only streaming as first token", () => {
    const report = vi.fn();
    const { rerender } = renderTiming(report);
    rerender({ status: "submitted", events: 3 });
    vi.advanceTimersByTime(1200);
    rerender({ status: "streaming", events: 3 });
    expect(report).not.toHaveBeenCalledWith("first_token", 1200);
  });

  it("stays idle when the session starts ready with no turn in flight", () => {
    const report = vi.fn();
    const { result } = renderTiming(report);
    expect(report).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });
});
