/**
 * @vitest-environment jsdom
 */
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listRoutesOptions } from "../../../src/api/hooks/use-route-detail";
import { getRouter } from "../../../src/router";
import { server } from "../../msw/node";
import {
  COMPLETED_ROUTE_ID,
  EMPTY_ROUTE_ID,
  SAVED_ROUTE_ID,
  userRoutesHandler,
  userRoutesOutageHandler,
} from "../../msw/user-routes";

afterEach(cleanup);
beforeEach(() => {
  server.use(userRoutesHandler);
});

async function openRoute(routeId: string, search: Readonly<{ hl?: "ja" | "zh" | "en" }> = {}) {
  const router = getRouter();
  router.options.context.queryClient.setDefaultOptions({ queries: { retry: false } });
  await router.navigate({ to: "/routes/$routeId", params: { routeId }, search });
  render(<RouterProvider router={router} />);
  return router;
}

describe("/routes/$routeId loader", () => {
  it("prefetches the saved routes into the per-request QueryClient", async () => {
    const router = await openRoute(SAVED_ROUTE_ID);
    await screen.findByRole("heading", { level: 1 });
    const cached = router.options.context.queryClient.getQueryData(listRoutesOptions().queryKey) as {
      readonly routes: readonly unknown[];
    };
    expect(Array.isArray(cached.routes)).toBe(true);
  });

  it("renders the matched route's title in the hero", async () => {
    await openRoute(SAVED_ROUTE_ID);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Suga Shrine loop");
  });

  it("renders the 完走 badge for a completed route", async () => {
    await openRoute(COMPLETED_ROUTE_ID);
    expect(await screen.findByText(/完走/)).toBeTruthy();
  });

  it("renders the empty state for a route with zero points", async () => {
    await openRoute(EMPTY_ROUTE_ID);
    expect(await screen.findByText("このルートにはまだ地点がありません")).toBeTruthy();
  });

  it("returns the branded 404 for an unknown route id", async () => {
    await openRoute("99999999-9999-4999-8999-999999999999");
    expect(await screen.findByRole("heading", { name: "404" })).toBeTruthy();
  });
});

describe("/routes/$routeId error state", () => {
  it("renders the branded error screen when the users service is unreachable", async () => {
    server.use(userRoutesOutageHandler);
    await openRoute(SAVED_ROUTE_ID);
    expect(await screen.findByText("エラーが発生しました")).toBeTruthy();
    expect(screen.getByRole("link", { name: "ホームに戻る" }).getAttribute("href")).toBe("/");
  });

  it("localizes the error screen and never leaks technical text", async () => {
    server.use(userRoutesOutageHandler);
    await openRoute(SAVED_ROUTE_ID, { hl: "zh" });
    expect(await screen.findByText("出错了")).toBeTruthy();
    expect(screen.queryByText(/users unavailable/)).toBeNull();
  });

  it("recovers via the try-again button once the service is back", async () => {
    server.use(userRoutesOutageHandler);
    await openRoute(SAVED_ROUTE_ID);
    await screen.findByRole("button", { name: "もう一度試す" });
    server.use(userRoutesHandler);
    fireEvent.click(screen.getByRole("button", { name: "もう一度試す" }));
    expect(await screen.findByText("Suga Shrine loop")).toBeTruthy();
  });
});
