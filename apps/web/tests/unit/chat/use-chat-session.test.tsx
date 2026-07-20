/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "../../../src/features/chat/use-chat-session";
import { server } from "../../msw/node";
import {
  CHAT_URL,
  chatHttpErrorHandler,
  chatStreamControlledHandler,
  chatStreamHandler,
  chatStreamHeldOpenHandler,
} from "../../msw/chat-handlers";

const { authHeaders } = vi.hoisted(() => ({ authHeaders: vi.fn().mockResolvedValue({}) }));
vi.mock("../../../src/lib/auth/authSession", () => ({ authHeaders }));

afterEach(() => {
  authHeaders.mockReset().mockResolvedValue({});
});

type Props = Readonly<{ sessionId?: string }>;

function renderSession(sessionId?: string) {
  return renderHook((props: Props) => useChatSession(CHAT_URL, props.sessionId), {
    initialProps: { sessionId },
  });
}

function spyingHandler(seen: (string | null)[], sessionId?: string) {
  return chatStreamHandler("search", {
    sessionId,
    spy: (request) => seen.push(request.headers.get("x-session-id")),
  });
}

/** Let a released stream tail cross the fetch boundary and be processed. */
async function drainLateFrames() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}

async function sendAndSettle(view: ReturnType<typeof renderSession>, text: string) {
  await act(async () => view.result.current.sendMessage({ text }));
  await waitFor(() => {
    expect(view.result.current.status).toBe("ready");
  });
}

describe("session id round-trip", () => {
  it("sends the ?session= id as the x-session-id header from the first turn", async () => {
    const seen: (string | null)[] = [];
    server.use(spyingHandler(seen));
    const view = renderSession("s-9");
    await sendAndSettle(view, "ユーフォ");
    expect(seen).toEqual(["s-9"]);
  });

  it("captures the streamed session_id and injects it into the follow-up turn", async () => {
    const seen: (string | null)[] = [];
    server.use(spyingHandler(seen, "srv-1"));
    const view = renderSession();
    await sendAndSettle(view, "ユーフォ");
    await sendAndSettle(view, "続きも教えて");
    expect(seen).toEqual([null, "srv-1"]);
  });
});

describe("session switch resets the chat instance", () => {
  it("clears messages when navigating from session A to session B", async () => {
    server.use(chatStreamHandler("search"));
    const view = renderSession("A");
    await sendAndSettle(view, "ユーフォ");
    expect(view.result.current.messages.length).toBeGreaterThan(0);
    view.rerender({ sessionId: "B" });
    expect(view.result.current.messages).toEqual([]);
  });

  it("drops an in-flight A stream instead of mixing it into session B", async () => {
    server.use(chatStreamHeldOpenHandler("search"));
    const view = renderSession("A");
    act(() => {
      void view.result.current.sendMessage({ text: "ユーフォ" });
    });
    await waitFor(() => {
      expect(view.result.current.messages.length).toBeGreaterThan(0);
    });
    view.rerender({ sessionId: "B" });
    expect(view.result.current.messages).toEqual([]);
    expect(view.result.current.status).toBe("ready");
  });

  it("never lets a late frame from the old stream leak its session id into B", async () => {
    const controlled = chatStreamControlledHandler("search", "stale-A");
    server.use(controlled.handler);
    const view = renderSession();
    act(() => {
      void view.result.current.sendMessage({ text: "ユーフォ" });
    });
    await waitFor(() => {
      expect(view.result.current.messages.length).toBeGreaterThan(0);
    });
    view.rerender({ sessionId: "B" });
    controlled.releaseFinal();
    await drainLateFrames();
    const seen: (string | null)[] = [];
    server.use(spyingHandler(seen));
    await sendAndSettle(view, "続き");
    expect(seen).toEqual(["B"]);
  });

  it("does not reset when the same session identity re-renders", async () => {
    server.use(chatStreamHandler("search"));
    const view = renderSession("A");
    await sendAndSettle(view, "ユーフォ");
    const count = view.result.current.messages.length;
    view.rerender({ sessionId: "A" });
    expect(view.result.current.messages.length).toBe(count);
  });
});

describe("failure-signal observability", () => {
  it("exposes the captured session id for disconnect recovery", async () => {
    server.use(chatStreamHandler("search", { sessionId: "srv-7" }));
    const view = renderSession();
    await sendAndSettle(view, "ユーフォ");
    expect(view.result.current.sessionIdOf()).toBe("srv-7");
  });

  it("records the HTTP status of a rejected chat request for classification", async () => {
    server.use(chatHttpErrorHandler(401));
    const view = renderSession("s-1");
    await act(async () => view.result.current.sendMessage({ text: "こんにちは" }));
    await waitFor(() => {
      expect(view.result.current.error).toBeTruthy();
    });
    expect(view.result.current.lastHttpStatus()).toBe(401);
  });
});

describe("auth header injection", () => {
  function authSpyingHandler(seen: (string | null)[]) {
    return chatStreamHandler("search", {
      spy: (request) => seen.push(request.headers.get("authorization")),
    });
  }

  it("sends no Authorization header when signed out", async () => {
    authHeaders.mockResolvedValue({});
    const seen: (string | null)[] = [];
    server.use(authSpyingHandler(seen));
    const view = renderSession("anon-1");
    await sendAndSettle(view, "ユーフォ");
    expect(seen).toEqual([null]);
  });

  it("injects the Bearer token from the current session on every turn", async () => {
    authHeaders.mockResolvedValue({ Authorization: "Bearer jwt-chat" });
    const seen: (string | null)[] = [];
    server.use(authSpyingHandler(seen));
    const view = renderSession("auth-1");
    await sendAndSettle(view, "ユーフォ");
    expect(seen).toEqual(["Bearer jwt-chat"]);
  });
});
