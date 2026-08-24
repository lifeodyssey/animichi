/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentWarmup } from "../../src/lib/agent-warmup";

afterEach(() => {
  vi.restoreAllMocks();
});

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => impl());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useAgentWarmup", () => {
  it("reaches the container on mount so the first turn does not pay the boot", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response("ok")));
    renderHook(() => { useAgentWarmup(); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1); });
    expect(fetchMock).toHaveBeenCalledWith("/healthz", { cache: "no-store" });
  });

  it("does not wake a container while a crawler renders the page", () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response("ok")));
    function Warmed() {
      useAgentWarmup();
      return null;
    }
    renderToString(createElement(Warmed));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays silent when the warmup request fails, since the turn can still run", async () => {
    const fetchMock = stubFetch(() => Promise.reject(new Error("offline")));
    const onError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderHook(() => { useAgentWarmup(); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1); });
    expect(onError).not.toHaveBeenCalled();
  });
});
