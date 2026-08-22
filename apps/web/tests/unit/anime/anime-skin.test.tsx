/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnimePage } from "../../../src/features/anime/AnimePage";
import { AnimePendingState } from "../../../src/features/anime/AnimeRouteStates";
import { emptyOverviewFixture, fullOverviewFixture } from "../../msw/anime-overview";

afterEach(cleanup);

/** The canvas classes the skin promises, asserted where the DOM spends them. */
function renderFull(): void {
  render(<AnimePage overview={fullOverviewFixture} locale="ja" />);
}

function classesOf(element: Element | null | undefined): string {
  return element?.className ?? "";
}

describe("hero", () => {
  it("wears the scoped hero title instead of the landing display h1", () => {
    renderFull();
    expect(classesOf(screen.getByRole("heading", { level: 1 }))).toContain("anime-hero__title");
  });

  it("states the spot and area counts as canvas meta pills", () => {
    renderFull();
    const pills = document.querySelectorAll(".anime-hero__meta .anime-pill--plain");
    expect([...pills].map((pill) => pill.textContent)).toEqual(["6件", "3エリア"]);
  });

  it("promises no counts on an empty work, where both would read zero", () => {
    render(<AnimePage overview={emptyOverviewFixture("404404")} locale="ja" />);
    expect(document.querySelector(".anime-hero__meta")).toBeNull();
  });

  it("localizes the area unit alongside the spot unit", () => {
    render(<AnimePage overview={fullOverviewFixture} locale="en" />);
    const pills = document.querySelectorAll(".anime-hero__meta .anime-pill--plain");
    expect([...pills].map((pill) => pill.textContent)).toEqual(["6 spots", "3 areas"]);
  });
});

describe("cards", () => {
  it("puts the fact block, every scene and the area panel on the card language", () => {
    renderFull();
    expect(classesOf(screen.getByRole("region", { name: "作品ファクト" }))).toContain("anime-card");
    expect(classesOf(document.querySelector(".anime-scenes > li"))).toContain("anime-card");
    expect(classesOf(document.querySelector(".anime-areas"))).toContain("anime-card");
  });

  it("gives the empty state the same card rather than a bare panel", () => {
    render(<AnimePage overview={emptyOverviewFixture("404404")} locale="ja" />);
    expect(classesOf(document.querySelector(".anime-empty"))).toContain("anime-card");
  });

  it("shapes the pending placeholders as skeleton cards", () => {
    render(<AnimePendingState />);
    expect(document.querySelectorAll(".anime-skeleton")).toHaveLength(3);
  });
});

describe("scene ranking", () => {
  it("numbers the ranking in shot-count order, top-ranked first", () => {
    renderFull();
    const ranks = document.querySelectorAll(".anime-scene__head .anime-pill");
    expect([...ranks].map((rank) => rank.textContent)).toEqual(["1", "2"]);
  });

  it("tints the top three gold, exactly as the canvas paints .rk.g", () => {
    renderFull();
    const first = document.querySelector(".anime-scene__head .anime-pill");
    expect(classesOf(first)).toContain("anime-pill--gold");
  });

  it("drops the gold tint past rank three", () => {
    const scene = fullOverviewFixture.scenes[0];
    if (scene === undefined) throw new Error("fixture must carry a scene");
    const scenes = [1, 2, 3, 4].map((n) => ({ ...scene, id: `s${String(n)}`, shot_count: 9 - n }));
    render(<AnimePage overview={{ ...fullOverviewFixture, scenes }} locale="ja" />);
    const ranks = [...document.querySelectorAll(".anime-scene__head .anime-pill")];
    expect(classesOf(ranks.at(-1))).toContain("anime-pill--plain");
  });

  it("keeps the shot count on the meta line under the name", () => {
    renderFull();
    expect(classesOf(document.querySelector(".anime-scene__meta"))).toContain("anime-scene__meta");
    expect(screen.getByText(/カット数 5 · Tokyo/)).toBeTruthy();
  });
});

describe("area rows", () => {
  it("counts each region in the teal canvas pill", () => {
    renderFull();
    const counts = document.querySelectorAll(".anime-area .anime-pill--teal");
    expect([...counts].map((count) => count.textContent)).toEqual(["2件", "3件", "1件"]);
  });
});
