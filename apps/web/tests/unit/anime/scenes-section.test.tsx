/**
 * @vitest-environment jsdom
 */
import type { AnimeScene } from "@seichijunrei/contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScenesSection } from "../../../src/features/anime/ScenesSection";
import { animeCopyFor } from "../../../src/features/anime/copy";

afterEach(cleanup);

function makeScene(overrides: Partial<AnimeScene>): AnimeScene {
  return {
    id: "scene-1",
    name: "Suga Shrine Stairs",
    screenshot_url: "https://cdn.test/scene-1.jpg",
    shot_count: 5,
    lat: 35.6852,
    lng: 139.7195,
    city: "Tokyo",
    ...overrides,
  };
}

function renderScenes(scene: AnimeScene) {
  render(<ScenesSection scenes={[scene]} copy={animeCopyFor("ja")} />);
}

describe("ScenesSection screenshots", () => {
  it("renders the screenshot image for a valid https url", () => {
    renderScenes(makeScene({}));
    const img = screen.getByRole("img", { name: "Suga Shrine Stairs" });
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("https://cdn.test/scene-1.jpg");
  });

  it("renders the placeholder when the contract delivers a null screenshot_url", () => {
    renderScenes(makeScene({ screenshot_url: null }));
    const shot = screen.getByRole("img", { name: "Suga Shrine Stairs" });
    expect(shot.tagName).not.toBe("IMG");
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders an accessible placeholder instead of an img when the url is empty", () => {
    renderScenes(makeScene({ screenshot_url: "" }));
    const shot = screen.getByRole("img", { name: "Suga Shrine Stairs" });
    expect(shot.tagName).not.toBe("IMG");
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders the placeholder for a non-http screenshot url", () => {
    renderScenes(makeScene({ screenshot_url: "not a url" }));
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Suga Shrine Stairs" })).toBeTruthy();
  });

  it("keeps the scene name and shot count next to the placeholder", () => {
    renderScenes(makeScene({ screenshot_url: "" }));
    expect(screen.getByText("Suga Shrine Stairs")).toBeTruthy();
    expect(screen.getByText(/カット数 5/)).toBeTruthy();
  });
});
