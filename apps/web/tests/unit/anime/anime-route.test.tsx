/**
 * @vitest-environment jsdom
 */
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { animeOverviewOptions } from "../../../src/api/hooks/use-anime-overview";
import { getRouter } from "../../../src/router";
import { animeOverviewHandler } from "../../msw/anime-overview";
import { server } from "../../msw/node";

afterEach(cleanup);

beforeEach(() => {
  server.use(animeOverviewHandler);
});

type AnimeSearch = Readonly<{ hl?: "ja" | "zh" | "en" }>;

async function openAnime(bangumiId: string, search: AnimeSearch = {}) {
  const router = getRouter();
  await router.navigate({ to: "/anime/$bangumiId", params: { bangumiId }, search });
  render(<RouterProvider router={router} />);
  return router;
}

describe("/anime/$bangumiId loader", () => {
  it("prefetches the overview into the per-request QueryClient", async () => {
    const router = await openAnime("123");
    await screen.findByRole("heading", { level: 1 });
    const cached = router.options.context.queryClient.getQueryData(
      animeOverviewOptions("123").queryKey,
    );
    expect(cached).toMatchObject({ bangumi_id: "123", points_length: 6 });
  });

  it("renders the full state from the loader data: facts and 名場面", async () => {
    await openAnime("123");
    expect(await screen.findByText(/Suga Shrine Stairs/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "作品ファクト" })).toBeTruthy();
  });
});

describe("/anime/$bangumiId head", () => {
  it("renders the localized document title for the default ja locale", async () => {
    await openAnime("123");
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => {
      expect(document.title).toContain("聖地巡礼マップ");
    });
  });

  it("hoists the trilingual hreflang alternates into the document head", async () => {
    await openAnime("123");
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => {
      const langs = [...document.querySelectorAll("link[rel=alternate]")].map(
        (link) => link.getAttribute("hreflang"),
      );
      expect(langs).toEqual(expect.arrayContaining(["ja", "zh", "en", "x-default"]));
    });
  });

  it("switches content and title to zh when hl=zh is in the search", async () => {
    await openAnime("123", { hl: "zh" });
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading.textContent).toContain("圣地巡礼");
    await waitFor(() => {
      expect(document.title).toContain("圣地巡礼地图");
    });
  });
});

describe("/anime/$bangumiId degraded states", () => {
  it("renders the empty state for a cataloged id with zero spots", async () => {
    await openAnime("999");
    expect(await screen.findByText("この作品はまだ聖地情報がありません")).toBeTruthy();
  });

  it("returns the branded 404 for a non-numeric bangumi id", async () => {
    await openAnime("not-an-id");
    expect(await screen.findByRole("heading", { name: "404" })).toBeTruthy();
  });
});
