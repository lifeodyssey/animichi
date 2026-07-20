/**
 * @vitest-environment jsdom
 */
import type { AnimeOverview } from "@seichijunrei/contract";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { animeOverviewOptions } from "../../../src/api/hooks/use-anime-overview";
import { makeQueryClient } from "../../../src/api/query-client";
import { BubbleMapPanel } from "../../../src/features/bubble-map/BubbleMapPanel";
import { bubbleMapCopyFor } from "../../../src/features/bubble-map/copy";
import { animeOverviewHandler } from "../../msw/anime-overview";
import { server } from "../../msw/node";

afterEach(cleanup);
beforeEach(() => { server.use(animeOverviewHandler); });

const copy = bubbleMapCopyFor("en");

/** Contract-typed loader: fetch the public overview through the shared query options. */
async function loadOverview(bangumiId: string): Promise<AnimeOverview> {
  const client = makeQueryClient();
  return client.fetchQuery(animeOverviewOptions(bangumiId));
}

function renderPanel(overview: AnimeOverview) {
  render(
    <BubbleMapPanel
      circles={overview.circles}
      scenes={overview.scenes}
      copy={copy}
      mapContainerRef={createRef<HTMLDivElement>()}
    />,
  );
}

describe("BubbleMapPanel with contract-typed overview data", () => {
  it("renders a bubble per region loaded from the catalog contract", async () => {
    renderPanel(await loadOverview("123"));
    expect(screen.getByRole("button", { name: /Tokyo/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Takayama/ })).toBeTruthy();
  });

  it("opens the region's shot-angle sheet on tap, filtered to its scenes", async () => {
    renderPanel(await loadOverview("123"));
    await userEvent.click(screen.getByRole("button", { name: /Tokyo/ }));
    const sheet = screen.getByRole("dialog", { name: /Tokyo/ });
    expect(sheet.textContent).toContain("Suga Shrine Stairs");
  });

  it("falls back to the empty area message for a region with no scenes", async () => {
    renderPanel(await loadOverview("123"));
    await userEvent.click(screen.getByRole("button", { name: /Takayama/ }));
    expect(screen.getByText(copy.sheetEmpty)).toBeTruthy();
  });

  it("closes the sheet when the close control is pressed", async () => {
    renderPanel(await loadOverview("123"));
    await userEvent.click(screen.getByRole("button", { name: /Tokyo/ }));
    await userEvent.click(screen.getByRole("button", { name: copy.close }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the empty map state for a cataloged id with zero regions", async () => {
    renderPanel(await loadOverview("999"));
    expect(screen.getByText(copy.empty)).toBeTruthy();
  });
});
