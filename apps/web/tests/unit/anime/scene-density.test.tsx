/**
 * @vitest-environment jsdom
 */
import type { AnimeScene } from "@animichi/contract";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnimePage } from "../../../src/features/anime/AnimePage";
import { fullOverviewFixture, hidaFurukawaStation } from "../../msw/anime-overview";

afterEach(cleanup);

/** Default view: 50m clusters already collapsed server-side, then cap 20 scenes. */
const SCENE_CAP = 20;
const POINT_COUNT = 200;

function manyScenes(): AnimeScene[] {
  return Array.from({ length: SCENE_CAP }, (_, index) => ({
    ...hidaFurukawaStation,
    id: `scene-${String(index)}`,
    name: `Scene ${String(index)}`,
    screenshot_url: `https://cdn.test/scene-${String(index)}.jpg`,
  }));
}

describe("anime page default view density", () => {
  it("does not issue one image request per point", () => {
    const overview = { ...fullOverviewFixture, points_length: POINT_COUNT, scenes: manyScenes() };
    render(<AnimePage overview={overview} locale="en" />);
    const images = document.querySelectorAll("img");
    expect(overview.points_length).toBe(POINT_COUNT);
    expect(images.length).toBe(SCENE_CAP);
    expect(images.length).toBeLessThan(POINT_COUNT);
    for (const img of images) {
      expect(img.getAttribute("src") ?? "").toContain("plan=h160");
    }
  });
});
