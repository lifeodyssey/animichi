/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AlbumGrid } from "../../../src/features/shiori/layouts/AlbumGrid";
import { makeItinerary, makeMeta, makePhotos } from "./_factories";

afterEach(cleanup);

function renderGrid(photoCount: number) {
  render(
    <AlbumGrid meta={makeMeta()} itinerary={makeItinerary()} photos={makePhotos(photoCount)} />,
  );
}

describe("AlbumGrid", () => {
  it("renders one tile per photo when the count fits the grid", () => {
    renderGrid(3);

    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it("caps the grid at four tiles and shows the overflow badge", () => {
    renderGrid(6);

    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.getByText("+2")).toBeTruthy();
  });

  it("converges an unusually large photo count into the capped grid", () => {
    renderGrid(500);

    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.getByText("+496")).toBeTruthy();
  });

  it("summarises the photo count with the time window", () => {
    renderGrid(5);

    expect(screen.getByText("09:31→12:58 · 対比図5枚")).toBeTruthy();
    expect(screen.getByText("SEICHIJUNREI · 完走記念")).toBeTruthy();
  });

  it("keeps the photo summary when the itinerary has no stops", () => {
    render(
      <AlbumGrid meta={makeMeta()} itinerary={makeItinerary({ stops: [] })} photos={makePhotos(3)} />,
    );

    expect(screen.getByText("対比図3枚")).toBeTruthy();
  });
});
