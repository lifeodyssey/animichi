/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "../../../src/features/chat/use-chat-session";
import {
  CHAT_URL,
  chatQuotaExhaustedHandler,
  chatTurnstileRequiredHandler,
} from "../../msw/chat-handlers";
import { server } from "../../msw/node";

const { authHeaders } = vi.hoisted(() => ({ authHeaders: vi.fn().mockResolvedValue({}) }));
vi.mock("../../../src/lib/auth/authSession", () => ({ authHeaders }));

afterEach(() => {
  authHeaders.mockReset().mockResolvedValue({});
});

function renderSession() {
  return renderHook(() => useChatSession(CHAT_URL, "anon-1"));
}

async function sendRejected(view: ReturnType<typeof renderSession>) {
  await act(async () => view.result.current.sendMessage({ text: "ユーフォ" }));
  await waitFor(() => {
    expect(view.result.current.error).toBeTruthy();
  });
}

describe("quota rejection envelope", () => {
  it("passes quota_resets_at through to the banner-facing session state", async () => {
    const resetsAt = "2099-01-01T00:00:00Z";
    server.use(chatQuotaExhaustedHandler(resetsAt));
    const view = renderSession();
    await sendRejected(view);
    expect(view.result.current.lastErrorCode()).toBe("anon_quota_exhausted");
    expect(view.result.current.lastQuotaResetsAt()).toBe(resetsAt);
  });

  it("does not misclassify a non-quota rejection as quota exhaustion", async () => {
    server.use(chatTurnstileRequiredHandler());
    const view = renderSession();
    await sendRejected(view);
    expect(view.result.current.lastErrorCode()).toBe("turnstile_required");
    expect(view.result.current.lastQuotaResetsAt()).toBeUndefined();
  });
});
