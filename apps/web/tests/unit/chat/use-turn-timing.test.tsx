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
  return renderHook(({ status }: { status: ChatStatus }) => useTurnTiming(status, wrapped), {
    initialProps: { status: "ready" as ChatStatus },
  });
}

describe("useTurnTiming", () => {
  it("reports first-token latency on the submitted→streaming transition", () => {
    const report = vi.fn();
    const { rerender } = renderTiming(report);
    rerender({ status: "submitted" });
    vi.advanceTimersByTime(1200);
    rerender({ status: "streaming" });
    expect(report).toHaveBeenCalledWith("first_token", 1200);
  });

  it("reports and returns the total turn duration once settled", () => {
    const report = vi.fn();
    const { rerender, result } = renderTiming(report);
    rerender({ status: "submitted" });
    vi.advanceTimersByTime(800);
    rerender({ status: "streaming" });
    vi.advanceTimersByTime(8400);
    rerender({ status: "ready" });
    expect(report).toHaveBeenCalledWith("turn", 9200);
    expect(result.current).toBe(9200);
  });

  it("stays idle when the session starts ready with no turn in flight", () => {
    const report = vi.fn();
    const { result } = renderTiming(report);
    expect(report).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });
});
