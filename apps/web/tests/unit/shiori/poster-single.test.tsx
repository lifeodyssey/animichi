/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PosterSingle } from "../../../src/features/shiori/layouts/PosterSingle";
import { makeItinerary, makeMeta, makePhoto, makePhotos } from "./_factories";

afterEach(cleanup);

describe("PosterSingle", () => {
  it("renders the hero comparison photo with its spot caption", () => {
    render(
      <PosterSingle meta={makeMeta()} itinerary={makeItinerary()} photos={[makePhoto()]} />,
    );

    expect(screen.getByRole("img", { name: "気多若宮神社 の対比図" })).toBeTruthy();
    expect(screen.getByText("気多若宮神社 ここに立った!")).toBeTruthy();
  });

  it("shows the photo counter for a single photo", () => {
    render(
      <PosterSingle meta={makeMeta()} itinerary={makeItinerary()} photos={[makePhoto()]} />,
    );

    expect(screen.getByText("1/1")).toBeTruthy();
  });

  it("shows a secondary thumbnail and its note when a second photo exists", () => {
    render(<PosterSingle meta={makeMeta()} itinerary={makeItinerary()} photos={makePhotos(2)} />);

    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getByRole("img", { name: "スポット2 の対比図" })).toBeTruthy();
    expect(screen.getByText("スポット2 のもう1枚も収録")).toBeTruthy();
  });

  it("renders the completion eyebrow and time window", () => {
    render(
      <PosterSingle meta={makeMeta()} itinerary={makeItinerary()} photos={[makePhoto()]} />,
    );

    expect(screen.getByText("SEICHIJUNREI · 完走記念")).toBeTruthy();
    expect(screen.getByText("09:31→12:58")).toBeTruthy();
  });

  it("stays a valid card when defensively rendered without photos", () => {
    render(<PosterSingle meta={makeMeta()} itinerary={makeItinerary()} photos={[]} />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("SEICHIJUNREI · 完走記念")).toBeTruthy();
  });
});
