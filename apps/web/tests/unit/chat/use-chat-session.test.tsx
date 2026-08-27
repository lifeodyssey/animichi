/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "../../../src/features/chat/use-chat-session";
import { server } from "../../msw/node";
import { CHAT_URL, chatStreamHandler } from "../../msw/chat-handlers";
import { recordingHead } from "../../msw/chat-stream-base";
import { SSE_HEADERS } from "../../msw/chat-sse";
import { http, HttpResponse } from "msw";

const { authHeaders } = vi.hoisted(() => ({ authHeaders: vi.fn().mockResolvedValue({}) }));
vi.mock("../../../src/lib/auth/auth-session", () => ({ authHeaders }));

afterEach(() => {
  authHeaders.mockReset().mockResolvedValue({});
});

type Props = Readonly<{ sessionId?: string }>;

function renderSession(sessionId?: string) {
  return renderHook((props: Props) => useChatSession(CHAT_URL, props.sessionId), {
    initialProps: { sessionId },
  });
}

async function sendAndSettle(view: ReturnType<typeof renderSession>, text: string) {
  await act(async () => view.result.current.sendMessage({ text }));
  await waitFor(() => {
    expect(view.result.current.status).toBe("ready");
  });
}

describe("Session offer round-trip (TURN-4 #955)", () => {
  it("sends a fresh x-turn-id on every turn", async () => {
    const seen: (string | null)[] = [];
    server.use(chatStreamHandler("search", { spy: (request) => seen.push(request.headers.get("x-turn-id")) }));
    const view = renderSession();
    await sendAndSettle(view, "ユーフォ");
    await sendAndSettle(view, "続きも教えて");
    expect(seen[0]).toBeTruthy();
    expect(seen[1]).toBeTruthy();
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("echoes the streamed revision and digest back on the follow-up turn", async () => {
    const seen: string[] = [];
    server.use(
      chatStreamHandler("search", {
        sessionId: "srv-1",
        sessionOffer: { revision: 2, digest: "deadbeef" },
        spy: (request) => {
          const revision = request.headers.get("x-session-revision") ?? "none";
          const digest = request.headers.get("x-session-digest") ?? "none";
          seen.push(`${revision}/${digest}`);
        },
      }),
    );
    const view = renderSession();
    await sendAndSettle(view, "ユーフォ");
    await sendAndSettle(view, "続きも教えて");
    expect(seen).toEqual(["none/none", "2/deadbeef"]);
  });
});

describe("session id round-trip", () => {
  it("sends the ?session= id as the x-session-id header from the first turn", async () => {
    const seen: (string | null)[] = [];
    server.use(chatStreamHandler("search", { spy: (request) => seen.push(request.headers.get("x-session-id")) }));
    const view = renderSession("s-9");
    await sendAndSettle(view, "ユーフォ");
    expect(seen).toEqual(["s-9"]);
  });

  it("captures the streamed session_id and injects it into the follow-up turn", async () => {
    const seen: (string | null)[] = [];
    server.use(chatStreamHandler("search", { sessionId: "srv-1", spy: (request) => seen.push(request.headers.get("x-session-id")) }));
    const view = renderSession();
    await sendAndSettle(view, "ユーフォ");
    await sendAndSettle(view, "続きも教えて");
    expect(seen).toEqual([null, "srv-1"]);
  });
});

function dropperSeen(seen: (string | null)[]) {
  return http.post(CHAT_URL, ({ request }) => {
    seen.push(request.headers.get("x-turn-id"));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(recordingHead("search")));
        controller.error(new Error("connection lost"));
      },
    });
    return new HttpResponse(body, { headers: SSE_HEADERS });
  });
}

describe("message-derived turn idempotency key (AC6 #1014, rederived per W1 #1220)", () => {

  it("keeps the same x-turn-id when the interrupted message itself is resent", async () => {
    const seen: (string | null)[] = [];
    server.use(dropperSeen(seen));
    const view = renderSession();
    act(() => {
      void view.result.current.sendMessage({ text: "ユーフォ" }).catch(() => undefined);
    });
    await waitFor(() => {
      expect(view.result.current.error).toBeTruthy();
    });
    expect(seen).toHaveLength(1);

    server.use(chatStreamHandler("search", { spy: (request) => seen.push(request.headers.get("x-turn-id")) }));
    await act(async () => {
      view.result.current.clearError();
      await view.result.current.regenerate();
    });
    await waitFor(() => {
      expect(view.result.current.status).toBe("ready");
    });
    // Same message object resent — the server dedups it under the SAME key.
    expect(seen[1]).toBeTruthy();
    expect(seen[1]).toBe(seen[0]);
  });

});

describe("fresh keys for new messages (W1 #1220)", () => {
  it("mints a fresh x-turn-id for a NEW message even after an interrupted turn", async () => {
    const seen: (string | null)[] = [];
    server.use(dropperSeen(seen));
    const view = renderSession();
    act(() => {
      void view.result.current.sendMessage({ text: "ユーフォ" }).catch(() => undefined);
    });
    await waitFor(() => {
      expect(view.result.current.error).toBeTruthy();
    });
    server.use(chatStreamHandler("search", { spy: (request) => seen.push(request.headers.get("x-turn-id")) }));
    await sendAndSettle(view, "続きも教えて");
    // A new message is a new logical turn: never the interrupted turn's key.
    expect(seen[1]).toBeTruthy();
    expect(seen[1]).not.toBe(seen[0]);
  });

  it("mints one fresh x-turn-id per new message across completed turns", async () => {
    const seen: (string | null)[] = [];
    server.use(chatStreamHandler("search", { spy: (request) => seen.push(request.headers.get("x-turn-id")) }));
    const view = renderSession();
    await sendAndSettle(view, "ユーフォ");
    await sendAndSettle(view, "続きも教えて");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeTruthy();
    expect(seen[1]).toBeTruthy();
    expect(seen[1]).not.toBe(seen[0]);
  });
});
