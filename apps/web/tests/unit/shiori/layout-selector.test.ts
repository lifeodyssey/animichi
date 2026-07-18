import { describe, expect, it } from "vitest";
import {
  ALBUM_GRID_CAPACITY,
  albumOverflowCount,
  selectShioriLayout,
  visibleAlbumCount,
} from "../../../src/features/shiori/layoutSelector";

describe("selectShioriLayout", () => {
  it.each([0, 1, 2, 3, 500])(
    "returns ticket for a planned route regardless of %i photos",
    (photoCount) => {
      expect(selectShioriLayout("planned", photoCount)).toBe("ticket");
    },
  );

  it("returns poster-fallback for a completed route with zero photos", () => {
    expect(selectShioriLayout("completed", 0)).toBe("poster-fallback");
  });

  it("returns poster-fallback for a completed route with a negative photo count", () => {
    expect(selectShioriLayout("completed", -3)).toBe("poster-fallback");
  });

  it.each([1, 2])("returns single-panel for a completed route with %i photos", (photoCount) => {
    expect(selectShioriLayout("completed", photoCount)).toBe("single-panel");
  });

  it.each([3, 4, 5, 10_000])(
    "returns album-grid for a completed route with %i photos",
    (photoCount) => {
      expect(selectShioriLayout("completed", photoCount)).toBe("album-grid");
    },
  );
});

describe("album grid density", () => {
  it("caps visible tiles at the grid capacity", () => {
    expect(visibleAlbumCount(10_000)).toBe(ALBUM_GRID_CAPACITY);
  });

  it("shows every photo when the count fits the capacity", () => {
    expect(visibleAlbumCount(3)).toBe(3);
  });

  it("reports how many photos overflow the grid", () => {
    expect(albumOverflowCount(6)).toBe(6 - ALBUM_GRID_CAPACITY);
  });

  it("reports zero overflow when the count fits the capacity", () => {
    expect(albumOverflowCount(ALBUM_GRID_CAPACITY)).toBe(0);
  });
});
