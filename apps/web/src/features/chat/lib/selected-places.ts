import type { SceneViewpoint } from "./scene-group";

/** Caller-grouped stopping places containing only selected viewpoints. */
export interface SelectedPlace {
  readonly id: string;
  readonly name: string;
  readonly city?: string;
  readonly viewpoints: readonly SceneViewpoint[];
}

export interface RemovedSelection {
  readonly place: SelectedPlace;
  readonly index: number;
  readonly viewpointIndex?: number;
}

export interface SelectionEdit {
  readonly places: readonly SelectedPlace[];
  readonly removed: RemovedSelection | null;
  readonly focusId: string | null;
}

function neighborId(places: readonly SelectedPlace[], index: number): string | null {
  return places[index + 1]?.id ?? places[index - 1]?.id ?? null;
}

export function removeSelectedPlace(places: readonly SelectedPlace[], place: SelectedPlace): SelectionEdit {
  const index = places.findIndex((item) => item.id === place.id);
  return { places: places.filter((item) => item.id !== place.id), removed: { place, index }, focusId: neighborId(places, index) };
}

export function removeSelectedViewpoint(places: readonly SelectedPlace[], place: SelectedPlace, viewpoint: SceneViewpoint): SelectionEdit {
  const index = places.findIndex((item) => item.id === place.id);
  const viewpoints = place.viewpoints.filter((item) => item.id !== viewpoint.id);
  const next = places.map((item) => item.id === place.id ? { ...item, viewpoints } : item).filter((item) => item.viewpoints.length > 0);
  const removed = { place: { ...place, viewpoints: [viewpoint] }, index, viewpointIndex: place.viewpoints.findIndex((item) => item.id === viewpoint.id) };
  return { places: next, removed, focusId: viewpoints.length ? place.id : neighborId(places, index) };
}

function restoredViewpoints(place: SelectedPlace, removed: RemovedSelection): readonly SceneViewpoint[] {
  const missing = removed.place.viewpoints.filter((viewpoint) => !place.viewpoints.some((item) => item.id === viewpoint.id));
  const index = Math.min(removed.viewpointIndex ?? place.viewpoints.length, place.viewpoints.length);
  return [...place.viewpoints.slice(0, index), ...missing, ...place.viewpoints.slice(index)];
}

/** Restore only the last removal, preserving later changes supplied by the caller. */
export function restoreSelected(places: readonly SelectedPlace[], removed: RemovedSelection): SelectionEdit {
  const existing = places.find((place) => place.id === removed.place.id);
  const index = Math.min(removed.index, places.length);
  const restored = existing ? places.map((place) => place.id === existing.id ? { ...place, viewpoints: restoredViewpoints(place, removed) } : place) : [...places.slice(0, index), removed.place, ...places.slice(index)];
  return { places: restored, removed: null, focusId: removed.place.id };
}
