/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "../../../src/features/chat/use-chat-session";
import {
  TURNSTILE_HEADER,
  clearTurnstileToken,
  rememberTurnstileToken,
} from "../../../src/lib/turnstile/tokenStore";
import { server } from "../../msw/node";
import { CHAT_URL, chatStreamHandler } from "../../msw/chat-handlers";

const { authHeaders } = vi.hoisted(() => ({ authHeaders: vi.fn().mockResolvedValue({}) }));
vi.mock("../../../src/lib/auth/authSession", () => ({ authHeaders }));

afterEach(() => {
  authHeaders.mockReset().mockResolvedValue({});
  clearTurnstileToken();
});

function tokenSpyingHandler(seen: (string | null)[]) {
  return chatStreamHandler("search", {
    spy: (request: Request) => seen.push(request.headers.get(TURNSTILE_HEADER)),
  });
}

function renderSession(sessionId?: string) {
  return renderHook(() => useChatSession(CHAT_URL, sessionId));
}

async function sendAndSettle(view: ReturnType<typeof renderSession>, text: string) {
  await act(async () => view.result.current.sendMessage({ text }));
  await waitFor(() => {
    expect(view.result.current.status).toBe("ready");
  });
}

describe("AC1 anonymous turns carry the solved Turnstile token", () => {
  it("sends the token as the cf-turnstile-response header", async () => {
    rememberTurnstileToken("solved-token");
    const seen: (string | null)[] = [];
    server.use(tokenSpyingHandler(seen));
    await sendAndSettle(renderSession("anon-1"), "ユーフォ");
    expect(seen).toEqual(["solved-token"]);
  });

  it("sends no challenge header when no token has been solved", async () => {
    const seen: (string | null)[] = [];
    server.use(tokenSpyingHandler(seen));
    await sendAndSettle(renderSession("anon-2"), "ユーフォ");
    expect(seen).toEqual([null]);
  });
});

/** Both turns fall inside one token window; the window boundary itself is
 * asserted against a mocked clock in turnstile-token-store.test.ts. */
describe("AC2 one challenge covers every turn in its window", () => {
  it("reuses the same token across follow-up turns without a new challenge", async () => {
    rememberTurnstileToken("solved-token");
    const seen: (string | null)[] = [];
    server.use(tokenSpyingHandler(seen));
    const view = renderSession("anon-3");
    await sendAndSettle(view, "ユーフォ");
    await sendAndSettle(view, "つづき");
    expect(seen).toEqual(["solved-token", "solved-token"]);
  });
});

describe("the challenge header is anonymous-only", () => {
  it("is omitted once the turn carries an Authorization bearer", async () => {
    authHeaders.mockResolvedValue({ Authorization: "Bearer jwt-chat" });
    rememberTurnstileToken("solved-token");
    const seen: (string | null)[] = [];
    server.use(tokenSpyingHandler(seen));
    await sendAndSettle(renderSession("auth-1"), "ユーフォ");
    expect(seen).toEqual([null]);
  });
});
