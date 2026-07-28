/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { useRecomputeTurn } from "../../../src/features/chat/selection/useRecomputeTurn";
import type { ChatSession } from "../../../src/features/chat/use-chat-session";

type ChatStub = Readonly<{
  sendSelectedPoints: ReturnType<typeof vi.fn>;
  status: string;
  error: Error | undefined;
}>;

function chatStub(status: string, error?: Error): ChatStub {
  return { sendSelectedPoints: vi.fn(), status, error };
}

function renderTurn(initial: ChatStub) {
  return renderHook(({ chat }: { chat: ChatStub }) => useRecomputeTurn(chat as unknown as ChatSession), {
    initialProps: { chat: initial },
  });
}

describe("useRecomputeTurn", () => {
  it("never fires the bypass with an empty selection", () => {
    const chat = chatStub("ready");
    const { result } = renderTurn(chat);
    act(() => {
      result.current.fire([]);
    });
    expect(chat.sendSelectedPoints).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expect(result.current.lastSentIds).toBeUndefined();
  });

  it("sends the body, tracks the sent ids, and settles back to idle on success", () => {
    const chat = chatStub("ready");
    const { result, rerender } = renderTurn(chat);
    act(() => {
      result.current.fire(["a", "b"]);
    });
    expect(chat.sendSelectedPoints).toHaveBeenCalledExactlyOnceWith({ selected_point_ids: ["a", "b"] });
    expect(result.current.status).toBe("busy");
    rerender({ chat: { ...chat, status: "streaming" } });
    rerender({ chat: { ...chat, status: "ready" } });
    expect(result.current.status).toBe("idle");
    expect(result.current.lastSentIds).toEqual(["a", "b"]);
  });

  it("reports failed on a settled error and clears once a new turn goes active", () => {
    const chat = chatStub("ready");
    const { result, rerender } = renderTurn(chat);
    act(() => {
      result.current.fire(["a"]);
    });
    rerender({ chat: { ...chat, status: "submitted" } });
    rerender({ chat: { ...chat, status: "error", error: new Error("boom") } });
    expect(result.current.status).toBe("failed");
    rerender({ chat: { ...chat, status: "submitted" } });
    expect(result.current.status).toBe("idle");
  });

  // Race guard: fire() flips to busy before the SDK reports "submitted"; a
  // settle signal seen before the turn ever went active must be ignored.
  it("ignores a settle that arrives before the turn ever went active", () => {
    const chat = chatStub("ready");
    const { result, rerender } = renderTurn(chat);
    act(() => {
      result.current.fire(["a"]);
    });
    rerender({ chat: { ...chat, status: "ready", error: new Error("stale") } });
    expect(result.current.status).toBe("busy");
  });
});
