/**
 * @vitest-environment jsdom
 */
import { renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
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
