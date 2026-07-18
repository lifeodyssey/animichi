/**
 * @vitest-environment jsdom
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { getRouter } from "../../src/router";

describe("getRouter", () => {
  it("builds a per-request QueryClient into the router context", () => {
    const router = getRouter();
    expect(router.options.context.queryClient).toBeInstanceOf(QueryClient);
  });

  it("does not share a QueryClient across requests", () => {
    const first = getRouter().options.context.queryClient;
    const second = getRouter().options.context.queryClient;
    expect(first).not.toBe(second);
  });

  it("wraps the app in a QueryClientProvider", () => {
    expect(typeof getRouter().options.Wrap).toBe("function");
  });

  it("wires client-side query hydration to avoid a double fetch", () => {
    expect(typeof getRouter().options.hydrate).toBe("function");
  });
});
