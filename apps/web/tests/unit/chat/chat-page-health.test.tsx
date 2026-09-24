/**
 * @vitest-environment jsdom
 */
import { renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBackendHealth } from "../../../src/features/chat/use-backend-health";
import { setLanguages } from "../_i18n";
import { server } from "../../msw/node";
import {
  CHAT_URL,
  chatStreamHandler,
  healthzControlledHandler,
  healthzDownHandler,
  healthzOkHandler,
  healthzUnavailableHandler,
} from "../../msw/chat-handlers";
import { chatTurnsAnswered } from "../../msw/chat-answered";
import { drainInFlightRequests, expectAbandonedRequests } from "../../msw/in-flight-requests";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { chatNavigation, chatSearch, renderChatPage } from "./_chat-page";

beforeEach(() => {
  setLanguages(["ja"]);
});

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useBackendHealth status", () => {
  it("starts pending and is not healthy before the probe resolves", () => {
    server.use(healthzOkHandler);
    const { result } = renderHook(() => useBackendHealth(TEST_ORIGIN), { wrapper });
    expect(result.current.status).toBe("pending");
    expect(result.current.healthy).toBe(false);
  });

  it("becomes healthy once the probe succeeds", async () => {
    server.use(healthzOkHandler);
    const { result } = renderHook(() => useBackendHealth(TEST_ORIGIN), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe("healthy");
    });
    expect(result.current.healthy).toBe(true);
  });

  it("reports down when the probe fails", async () => {
    server.use(healthzDownHandler);
    const { result } = renderHook(() => useBackendHealth(TEST_ORIGIN), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe("down");
    });
    expect(result.current.healthy).toBe(false);
  });

  it("reports down when healthz answers a non-ok status, not only a dead connection", async () => {
    server.use(healthzUnavailableHandler);
    const { result } = renderHook(() => useBackendHealth(TEST_ORIGIN), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe("down");
    });
    expect(result.current.healthy).toBe(false);
  });
});

describe("A2 auto-send health gate", () => {
  it("never sends ?q= when the backend probe fails", async () => {
    server.use(healthzDownHandler);
    renderChatPage(chatSearch({ q: "ハルヒ" }), false);
    await screen.findByRole("alert");
    expect(screen.queryByText("ハルヒ")).toBeNull();
  });

  /**
   * #1512 AC1, re-mechanised by #1901. The first mount mints the session id
   * into the address bar while the probe is still pending, so the REMOUNT
   * reads `?session=` back and reconnects instead of auto-sending. The
   * reconnect's 404 — nothing ever reached the edge — is what sends the hero
   * query, and it waits on the same health gate the first send did. One POST
   * across both mounts, exactly as before.
   *
   * Both mounts share this visit's query cache, exactly as they share the
   * app's (`src/router.tsx`), which is what makes that the real ordering
   * rather than a harness artefact.
   *
   * A turn here is a POST to the chat endpoint: the AI SDK's `submit-message`.
   */
  it("sends ?q= once when the page remounts while the health probe is still pending", async () => {
    const turns: string[] = [];
    const probe = healthzControlledHandler();
    server.use(
      probe.handler,
      chatStreamHandler("search", { spy: (request) => turns.push(request.url) }),
      http.get("*/v1/conversations/:sessionId/stream", () => new HttpResponse(null, { status: 404 })),
      http.get("*/v1/conversations/:sessionId/messages", () => new HttpResponse(null, { status: 404 })),
    );
    const visit = chatNavigation(chatSearch({ q: "ハルヒ" }), false);

    visit.mount().unmount();
    visit.mount();
    expectAbandonedRequests(1);
    await drainInFlightRequests();
    expect(turns).toEqual([]);

    const answered = chatTurnsAnswered(1);
    probe.release();
    await answered;
    await drainInFlightRequests();
    expect(turns).toEqual([CHAT_URL]);
  });
});

// #1596: the warm-up hook existed only to wake the agent container, and the
// edge answers `/healthz` itself now (`workers/edge/src/gateway/request.ts`),
// so the chat page's own-origin probe would only waste a request — the real
// backend probe goes to `TEST_ORIGIN`. This is the network-log half of the
// card's browser AC, at the unit seam; the deployed-origin recording is
// deferred to staging.
describe("the chat page's network surface", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("issues no warm-up request to the page's own origin", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderChatPage();
    const warmupCalls = fetchSpy.mock.calls.filter(([input]) => input === "/healthz");
    expect(warmupCalls).toEqual([]);
  });
});
