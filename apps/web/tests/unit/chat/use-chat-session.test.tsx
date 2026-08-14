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

describe("stable turn idempotency key (AC6 #1014)", () => {
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

  it("reuses the pinned x-turn-id when a stream-interrupted send is retried", async () => {
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
    await sendAndSettle(view, "続きも教えて");
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeTruthy();
    // The retried turn must reuse the interrupted turn id, not mint a new one.
    expect(seen[1]).toBe(seen[0]);
  });

  it("mints a fresh x-turn-id only after the previous turn completed", async () => {
    const seen: (string | null)[] = [];
    function completingSpy(request: Request) {
      seen.push(request.headers.get("x-turn-id"));
    }
    server.use(chatStreamHandler("search", { spy: completingSpy }));
    const view = renderSession();
    await sendAndSettle(view, "ユーフォ");
    await sendAndSettle(view, "続きも教えて");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeTruthy();
    expect(seen[1]).toBeTruthy();
    expect(seen[1]).not.toBe(seen[0]);
  });
});
