/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShioriCard } from "../../../src/features/shiori/ShioriCard";
import type { ShioriStatus } from "../../../src/features/shiori/layoutSelector";
import { makeItinerary, makeMeta, makePhotos } from "./_factories";

afterEach(cleanup);

function renderCard(status: ShioriStatus, photoCount: number) {
  render(
    <ShioriCard
      status={status}
      meta={makeMeta()}
      itinerary={makeItinerary()}
      photos={makePhotos(photoCount)}
    />,
  );
}

describe("ShioriCard", () => {
  it("renders the planned ticket regardless of photos", () => {
    renderCard("planned", 5);

    expect(screen.getByRole("article", { name: "計画しおり" })).toBeTruthy();
  });

  it("renders the album grid when three or more photos are selected", () => {
    renderCard("completed", 3);

    expect(screen.getByRole("article", { name: "完走記念しおり" })).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("renders the single panel when one photo is selected", () => {
    renderCard("completed", 1);

    expect(screen.getByRole("article", { name: "完走記念しおり" })).toBeTruthy();
    expect(screen.getByText("1/1")).toBeTruthy();
  });

  it("falls back to the poster when zero photos are selected", () => {
    renderCard("completed", 0);

    expect(screen.getByRole("article", { name: "完走ポスター" })).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
