/**
 * @vitest-environment jsdom
 */
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRouter } from "../../../src/router";
import {
  animeOverviewGatewayNotFoundHandler,
  animeOverviewHandler,
  animeOverviewNotFoundHandler,
} from "../../msw/anime-overview";
import { server } from "../../msw/node";

afterEach(cleanup);

beforeEach(() => {
  server.use(animeOverviewHandler);
});

async function openAnime(bangumiId: string) {
  const router = getRouter();
  router.options.context.queryClient.setDefaultOptions({ queries: { retry: false } });
  await router.navigate({ to: "/anime/$bangumiId", params: { bangumiId }, search: {} });
  render(<RouterProvider router={router} />);
  return router;
}

function robotsContent(): string | null {
  return document.querySelector("meta[name=robots]")?.getAttribute("content") ?? null;
}

describe("/anime/$bangumiId soft-404 defense", () => {
  it("renders the branded 404 when the catalog reports an unknown work", async () => {
    server.use(animeOverviewNotFoundHandler);
    await openAnime("654321");
    expect(await screen.findByRole("heading", { name: "404" })).toBeTruthy();
    expect(screen.queryByText(/WORK_NOT_FOUND/)).toBeNull();
  });

  it("treats an untyped gateway 404 as an outage, not an unknown work", async () => {
    server.use(animeOverviewGatewayNotFoundHandler);
    await openAnime("123");
    expect(await screen.findByText("Something went wrong")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "404" })).toBeNull();
  });

  it("marks the empty-overview page as noindex for crawlers", async () => {
    await openAnime("999");
    await screen.findByText("この作品はまだ聖地情報がありません");
    await waitFor(() => {
      expect(robotsContent()).toBe("noindex");
    });
  });

  it("keeps the full overview page indexable", async () => {
    await openAnime("123");
    await screen.findByText(/Suga Shrine Stairs/);
    await waitFor(() => {
      expect(document.title).toContain("聖地巡礼マップ");
    });
    expect(robotsContent()).toBeNull();
  });
});
