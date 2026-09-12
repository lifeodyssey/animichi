import { describe, expect, it } from "vitest";
import { removeSelectedPlace, removeSelectedViewpoint, restoreSelected } from "../../../src/features/chat/lib/selected-places";
import type { SelectedPlace } from "../../../src/features/chat/lib/selected-places";

const viewpoint = { id: "first", frames: [{ id: "frame" }] };
const place: SelectedPlace = { id: "a", name: "A", viewpoints: [viewpoint] };
const another: SelectedPlace = { id: "b", name: "B", viewpoints: [{ id: "second", frames: [] }] };

describe("selection edits", () => {
  it("removes a place when its last viewpoint is removed", () => {
    expect(removeSelectedViewpoint([place, another], place, viewpoint).places).toEqual([another]);
  });

  it("moves focus backward when removing the final row", () => {
    expect(removeSelectedPlace([place, another], another).focusId).toBe(place.id);
  });

  it("restores a removed place without dropping later external additions", () => {
    expect(restoreSelected([another], { place, index: 0 }).places).toEqual([place, another]);
  });

  it("merges an undone viewpoint into current external selection without duplicates", () => {
    const updated = { ...place, viewpoints: [viewpoint, ...another.viewpoints] };
    expect(restoreSelected([updated], { place, index: 0, viewpointIndex: 0 }).places).toEqual([updated]);
  });

  it("restores viewpoint order while retaining newly selected viewpoints", () => {
    const updated = { ...place, viewpoints: another.viewpoints };
    expect(restoreSelected([updated], { place, index: 0, viewpointIndex: 0 }).places).toEqual([{ ...place, viewpoints: [viewpoint, ...another.viewpoints] }]);
  });
});
