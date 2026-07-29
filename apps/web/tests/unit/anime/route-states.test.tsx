/**
 * @vitest-environment jsdom
 */
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnimePendingState } from "../../../src/features/anime/route-states";
import { getRouter } from "../../../src/router";
import { animeOverviewHandler, animeOverviewOutageHandler } from "../../msw/anime-overview";
import { server } from "../../msw/node";

afterEach(cleanup);

async function openAnime(bangumiId: string, search: Readonly<{ hl?: "ja" | "zh" | "en" }> = {}) {
  const router = getRouter();
  router.options.context.queryClient.setDefaultOptions({ queries: { retry: false } });
  await router.navigate({ to: "/anime/$bangumiId", params: { bangumiId }, search });
  render(<RouterProvider router={router} />);
  return router;
}

describe("AnimePendingState", () => {
  it("announces a loading status while the overview loads", () => {
    render(<AnimePendingState />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
  });
});

describe("/anime/$bangumiId error state", () => {
  it("renders the branded error screen when the catalog is unreachable", async () => {
    server.use(animeOverviewOutageHandler);
    await openAnime("123");
    expect(await screen.findByText("Animichi")).toBeTruthy();
    expect(screen.getByText("エラーが発生しました")).toBeTruthy();
    expect(screen.getByRole("link", { name: "ホームに戻る" }).getAttribute("href")).toBe("/");
  });

  it("localizes the error screen when hl=zh is in the search", async () => {
    server.use(animeOverviewOutageHandler);
    await openAnime("123", { hl: "zh" });
    expect(await screen.findByText("出错了")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "返回首页" })).toBeTruthy();
  });

  it("never leaks the technical error text to the user", async () => {
    server.use(animeOverviewOutageHandler);
    await openAnime("123");
    await screen.findByText("エラーが発生しました");
    expect(screen.queryByText(/catalog unavailable/)).toBeNull();
    expect(screen.queryByText(/INTERNAL_SERVER_ERROR/)).toBeNull();
  });

  it("recovers via the try-again button once the catalog is back", async () => {
    server.use(animeOverviewOutageHandler);
    await openAnime("123");
    await screen.findByRole("button", { name: "もう一度試す" });
    server.use(animeOverviewHandler);
    // Re-query at click time: the boundary recreates the subtree after the catch.
    fireEvent.click(screen.getByRole("button", { name: "もう一度試す" }));
    expect(await screen.findByText(/Suga Shrine Stairs/)).toBeTruthy();
  });
});
