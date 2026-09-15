/**
 * @vitest-environment jsdom
 */
import { renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBackendHealth } from "../../../src/features/chat/use-backend-health";
import { setLanguages } from "../_i18n";
import { server } from "../../msw/node";
import { healthzDownHandler, healthzOkHandler } from "../../msw/chat-handlers";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { chatSearch, renderChatPage } from "./_chat-page";

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
});

describe("A2 auto-send health gate", () => {
  it("never sends ?q= when the backend probe fails", async () => {
    server.use(healthzDownHandler);
    renderChatPage(chatSearch({ q: "ハルヒ" }), false);
    await screen.findByRole("alert");
    expect(screen.queryByText("ハルヒ")).toBeNull();
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
