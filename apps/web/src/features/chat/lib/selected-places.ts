import type { SceneFrame, SceneViewpoint } from "./scene-group";
import type { SearchSpot } from "./spot-clusters";

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

/** Browsing gives one spot id one place with at most one captured frame; the
 * review list reuses the stable spot id as the place identity (issue #1641). */
export function toSelectedPlace(spot: SearchSpot): SelectedPlace {
  const frames: readonly SceneFrame[] = spot.screenshotUrl === undefined ? [] : [{ id: `${spot.id}-frame`, url: spot.screenshotUrl }];
  const viewpoint: SceneViewpoint = { id: `${spot.id}-scene`, frames };
  return { id: spot.id, name: spot.name, city: spot.city, viewpoints: [viewpoint] };
}

/** Review list in the caller's spot order; membership keys on the id, never the index. */
export function selectedPlacesFromSpots(spots: readonly SearchSpot[], selected: ReadonlySet<string>): readonly SelectedPlace[] {
  return spots.filter((spot) => selected.has(spot.id)).map(toSelectedPlace);
}

/** Place ids to flip so `current` becomes `next`; undo re-adds, so both directions flow. */
export function placeIdToggles(current: readonly SelectedPlace[], next: readonly SelectedPlace[]): readonly string[] {
  const kept = new Set(next.map((place) => place.id));
  const known = new Set(current.map((place) => place.id));
  return [
    ...current.filter((place) => !kept.has(place.id)).map((place) => place.id),
    ...next.filter((place) => !known.has(place.id)).map((place) => place.id),
  ];
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
