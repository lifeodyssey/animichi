/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStreamRecovery } from "../../../src/features/chat/use-stream-recovery";
import { clearAuthToken } from "../../../src/lib/auth/authSession";
import {
  conversationMessagesErrorHandler,
  conversationMessagesHandler,
} from "../../msw/chat-handlers";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { server } from "../../msw/node";

vi.mock(import("../../../src/lib/auth/authSession"), { spy: true });

function fakeChat() {
  return { setMessages: vi.fn(), clearError: vi.fn(), regenerate: vi.fn().mockResolvedValue(undefined) };
}

function renderRecovery(chat: ReturnType<typeof fakeChat>, sessionId?: string) {
  return renderHook(() => useStreamRecovery(TEST_ORIGIN, chat, () => sessionId));
}

describe("useStreamRecovery without a persisted session", () => {
  it("falls back to regenerating the failed turn", () => {
    const chat = fakeChat();
    const view = renderRecovery(chat);
    act(() => { view.result.current.recover(); });
    expect(chat.clearError).toHaveBeenCalledTimes(1);
    expect(chat.regenerate).toHaveBeenCalledTimes(1);
  });
});

describe("useStreamRecovery with a persisted session", () => {
  const FINAL_STATE = [
    { role: "user", content: "ユーフォ" },
    { role: "assistant", content: "宇治の聖地を2件、徒歩ルートにまとめました。" },
  ];

  it("re-reads the session's final state from GET /v1/conversations/{id}/messages", async () => {
    const seen: string[] = [];
    server.use(conversationMessagesHandler("s-9", FINAL_STATE, (request) => seen.push(request.url)));
    const chat = fakeChat();
    const view = renderRecovery(chat, "s-9");
    act(() => { view.result.current.recover(); });
    await waitFor(() => { expect(chat.setMessages).toHaveBeenCalledTimes(1); });
    expect(seen[0]).toContain("/v1/conversations/s-9/messages");
    expect(chat.clearError).toHaveBeenCalledTimes(1);
    expect(chat.regenerate).not.toHaveBeenCalled();
  });

  it("maps the fetched rows onto user/assistant text messages", async () => {
    server.use(conversationMessagesHandler("s-9", FINAL_STATE));
    const chat = fakeChat();
    const view = renderRecovery(chat, "s-9");
    act(() => { view.result.current.recover(); });
    await waitFor(() => { expect(chat.setMessages).toHaveBeenCalledTimes(1); });
    const messages = chat.setMessages.mock.calls[0]?.[0] as {
      role: string;
      parts: { type: string; text: string }[];
    }[];
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.parts[0]?.text).toBe("宇治の聖地を2件、徒歩ルートにまとめました。");
  });

  it("keeps the failure state when the final-state fetch itself fails", async () => {
    server.use(conversationMessagesErrorHandler("s-9", 500));
    const chat = fakeChat();
    const view = renderRecovery(chat, "s-9");
    act(() => { view.result.current.recover(); });
    await waitFor(() => { expect(view.result.current.recovering).toBe(false); });
    expect(chat.setMessages).not.toHaveBeenCalled();
    expect(chat.clearError).not.toHaveBeenCalled();
  });

  it("drops the cached auth token before an expired-session resume", async () => {
    server.use(conversationMessagesHandler("s-9", []));
    const chat = fakeChat();
    const view = renderRecovery(chat, "s-9");
    act(() => { view.result.current.recoverExpired(); });
    expect(clearAuthToken).toHaveBeenCalledTimes(1);
    await waitFor(() => { expect(chat.setMessages).toHaveBeenCalled(); });
  });
});
