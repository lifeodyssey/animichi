/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useConversationHistory } from "../../../src/features/chat/use-conversation-history";
import { server } from "../../msw/node";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { conversationMessagesHandler } from "../../msw/chat-handlers";

const { authHeaders } = vi.hoisted(() => ({ authHeaders: vi.fn() }));
vi.mock("../../../src/lib/auth/authSession", () => ({ authHeaders }));

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderHistory(sessionId: string) {
  return renderHook(() => useConversationHistory(TEST_ORIGIN, sessionId), { wrapper });
}

describe("useConversationHistory auth header injection", () => {
  it("fetches without an Authorization header when signed out", async () => {
    authHeaders.mockResolvedValue({});
    let seen: string | null = "unset";
    server.use(
      conversationMessagesHandler("s-anon", [], (request) => {
        seen = request.headers.get("authorization");
      }),
    );
    const view = renderHistory("s-anon");
    await waitFor(() => { expect(view.result.current.status).toBe("success"); });
    expect(seen).toBeNull();
  });

  it("injects the Bearer token when signed in", async () => {
    authHeaders.mockResolvedValue({ Authorization: "Bearer jwt-xyz" });
    let seen: string | null = "unset";
    server.use(
      conversationMessagesHandler("s-auth", [], (request) => {
        seen = request.headers.get("authorization");
      }),
    );
    const view = renderHistory("s-auth");
    await waitFor(() => { expect(view.result.current.status).toBe("success"); });
    expect(seen).toBe("Bearer jwt-xyz");
  });
});
