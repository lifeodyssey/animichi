/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "../../../src/features/chat/use-chat-session";
import { useStreamRecovery } from "../../../src/features/chat/use-stream-recovery";
import { server } from "../../msw/node";
import { CHAT_URL, chatStreamHandler, conversationMessagesHandler } from "../../msw/chat-handlers";
import { TEST_ORIGIN } from "../../msw/fixtures";

const { authHeaders } = vi.hoisted(() => ({ authHeaders: vi.fn().mockResolvedValue({}) }));
vi.mock("../../../src/lib/auth/auth-session", () => ({ authHeaders }));

afterEach(() => {
  authHeaders.mockReset().mockResolvedValue({});
});

type SessionProps = Readonly<{ sessionId?: string }>;

/** Wire the real useChatSession to useStreamRecovery, the page-level AC6 seam. */
function renderSessionWithRecovery(initialSessionId?: string) {
  return renderHook((props: SessionProps) => {
    const session = useChatSession(CHAT_URL, props.sessionId);
    const { recover, recovering } = useStreamRecovery(
      TEST_ORIGIN,
      {
        setMessages: session.setMessages,
        clearError: () => undefined,
        regenerate: () => Promise.resolve(),
      },
      session.sessionIdOf,
    );
    return { ...session, recover, recovering, sessionIdOf: session.sessionIdOf };
  }, { initialProps: { sessionId: initialSessionId } });
}

async function sendAndSettle(view: ReturnType<typeof renderSessionWithRecovery>, text: string) {
  await act(async () => view.result.current.sendMessage({ text }));
  await waitFor(() => {
    expect(view.result.current.status).toBe("ready");
  });
}

const PERSISTED = [
  { role: "user", content: "ユーフォ" },
  { role: "assistant", content: "宇治の聖地を徒歩ルートにまとめました。" },
];

describe("AC6 turn-idempotency reconnect recovery (browser)", () => {
  it("after a commit, reconnect re-fetches the persisted state and converges without duplicate cards", async () => {
    server.use(chatStreamHandler("search", { sessionId: "srv-ac6", sessionOffer: { revision: 3, digest: "abc" } }));
    const view = renderSessionWithRecovery();
    await sendAndSettle(view, "ユーフォ");

    // The turn committed a server session offer; the client surfaces its id,
    // the handle the recovery flow uses to re-read persisted messages.
    expect(view.result.current.sessionIdOf()).toBe("srv-ac6");
    const committedCount = view.result.current.messages.length;
    expect(committedCount).toBeGreaterThan(0);

    server.use(conversationMessagesHandler("srv-ac6", PERSISTED));
    act(() => { view.result.current.recover(); });
    // Converged to the persisted rows: one user + one assistant card — the
    // interrupted live stream did NOT leave an extra duplicate card behind,
    // and the client surfaced then cleared its recovery state.
    await waitFor(() => {
      expect(view.result.current.messages).toHaveLength(PERSISTED.length);
    });
    await waitFor(() => {
      expect(view.result.current.recovering).toBe(false);
    });
    const roles = view.result.current.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant"]);
  });

  it("surfaces a recovering state while the persisted state is being re-fetched", async () => {
    server.use(chatStreamHandler("search", { sessionId: "srv-ac7" }));
    const view = renderSessionWithRecovery();
    await sendAndSettle(view, "ユーフォ");
    expect(view.result.current.recovering).toBe(false);

    server.use(conversationMessagesHandler("srv-ac7", PERSISTED));
    act(() => { view.result.current.recover(); });
    // The recovery starts on the recovered (committed) session path.
    await waitFor(() => {
      expect(view.result.current.recovering).toBe(true);
    });
    await waitFor(() => {
      expect(view.result.current.recovering).toBe(false);
    });
  });

  it("regenerate fallback (no persisted session) uses the turn idempotency path, not a rerun", async () => {
    // No session was committed yet: recovery falls back to regenerating the
    // interrupted turn with the SAME pinned x-turn-id (the AC6 idempotency key).
    const seen: (string | null)[] = [];
    server.use(chatStreamHandler("search", { spy: (request) => seen.push(request.headers.get("x-turn-id")) }));
    const view = renderSessionWithRecovery();
    await sendAndSettle(view, "ユーフォ");
    expect(seen).toHaveLength(1);
    expect(view.result.current.sessionIdOf()).toBeUndefined();
  });
});
