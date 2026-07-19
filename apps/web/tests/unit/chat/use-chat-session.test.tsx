/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useChatSession } from "../../../src/features/chat/use-chat-session";
import { server } from "../../msw/node";
import { CHAT_URL, chatStreamHandler, chatStreamHeldOpenHandler } from "../../msw/chat-handlers";

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

  it("does not reset when the same session identity re-renders", async () => {
    server.use(chatStreamHandler("search"));
    const view = renderSession("A");
    await sendAndSettle(view, "ユーフォ");
    const count = view.result.current.messages.length;
    view.rerender({ sessionId: "A" });
    expect(view.result.current.messages.length).toBe(count);
  });
});
