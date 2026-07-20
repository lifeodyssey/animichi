/**
 * @vitest-environment jsdom
 */
import type { AnimeScene } from "@seichijunrei/contract";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpotSheet } from "../../../src/features/bubble-map/SpotSheet";
import { bubbleMapCopyFor } from "../../../src/features/bubble-map/copy";

afterEach(cleanup);

const copy = bubbleMapCopyFor("en");

function scene(overrides: Partial<AnimeScene>): AnimeScene {
  return {
    id: "s1",
    name: "Suga Shrine Stairs",
    screenshot_url: "https://cdn.test/s1.jpg",
    shot_count: 5,
    lat: 35.68,
    lng: 139.71,
    city: "Tokyo",
    ...overrides,
  };
}

function renderSheet(scenes: readonly AnimeScene[], onClose = vi.fn()) {
  render(<SpotSheet region="Tokyo" scenes={scenes} copy={copy} onClose={onClose} />);
  return onClose;
}

describe("SpotSheet", () => {
  it("titles the sheet with the tapped region", () => {
    renderSheet([scene({})]);
    expect(screen.getByRole("dialog", { name: /Tokyo/ })).toBeTruthy();
  });

  it("renders the shot photo when the scene has a renderable url", () => {
    renderSheet([scene({})]);
    const img = screen.getByRole("img", { name: "Suga Shrine Stairs" });
    expect(img.tagName).toBe("IMG");
  });

  it("shows a photo-less spot gracefully instead of a blank sheet", () => {
    renderSheet([scene({ screenshot_url: null })]);
    expect(screen.getByText("Suga Shrine Stairs")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Suga Shrine Stairs" }).tagName).not.toBe("IMG");
    expect(document.querySelector("img")).toBeNull();
  });

  it("shows an empty-area message when the region has no spots at all", () => {
    renderSheet([]);
    expect(screen.getByText(copy.sheetEmpty)).toBeTruthy();
  });

  it("closes when the close control is pressed", async () => {
    const onClose = renderSheet([scene({})]);
    await userEvent.click(screen.getByRole("button", { name: copy.close }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
