import type { ItineraryDraftPlan } from "./itinerary-draft";
import type { SceneViewpoint } from "./scene-group";
import type { SelectedPlace, SelectionEdit } from "./selected-places";
import { removeSelectedPlace } from "./selected-places";

/** The exact proposed selection and text, tied to the original usable draft. */
export interface DraftAdjustmentRequest {
  readonly draftId: string;
  readonly instruction: string;
  readonly places: readonly SelectedPlace[];
}

export type DraftAdjustmentStatus = "ready" | "updating" | "failed";

function sameSelectedPlace(place: SelectedPlace, current?: SelectedPlace): boolean {
  if (!current || place.id !== current.id || place.viewpoints.length !== current.viewpoints.length) return false;
  return place.viewpoints.every((viewpoint, index) => viewpoint.id === current.viewpoints[index]?.id);
}

export function draftSelectionChanged(draft: ItineraryDraftPlan, places: readonly SelectedPlace[]): boolean {
  return draft.stops.length !== places.length || draft.stops.some(({ place }, index) => !sameSelectedPlace(place, places[index]));
}

/** Old model prose may describe a removed place/viewpoint. Only fresh output can replace it. */
export function draftWithSelection(draft: ItineraryDraftPlan, places: readonly SelectedPlace[]): ItineraryDraftPlan {
  if (!draftSelectionChanged(draft, places)) return draft;
  return { ...draft, introduction: undefined, assumptions: [], stops: places.map((place) => ({ place })) };
}

export function addDraftViewpoint(places: readonly SelectedPlace[], source: SelectedPlace, viewpoint: SceneViewpoint): readonly SelectedPlace[] {
  const existing = places.find((place) => place.id === source.id);
  if (!existing) return [...places, { ...source, viewpoints: [viewpoint] }];
  if (existing.viewpoints.some((item) => item.id === viewpoint.id)) return places;
  const ids = new Set([...existing.viewpoints.map((item) => item.id), viewpoint.id]);
  const available = new Map([...source.viewpoints, ...existing.viewpoints].map((item) => [item.id, item]));
  const viewpoints = [...available.values()].filter((item) => ids.has(item.id));
  return places.map((place) => place.id === source.id ? { ...place, viewpoints } : place);
}

export function removeDraftViewpoint(places: readonly SelectedPlace[], place: SelectedPlace, viewpoint: SceneViewpoint): SelectionEdit {
  if (place.viewpoints.length === 1) return removeSelectedPlace(places, place);
  const index = places.findIndex((item) => item.id === place.id);
  const next = places.map((item) => item.id === place.id ? { ...item, viewpoints: item.viewpoints.filter((frame) => frame.id !== viewpoint.id) } : item);
  return { places: next, removed: { place: { ...place, viewpoints: [viewpoint] }, index, viewpointIndex: place.viewpoints.findIndex((item) => item.id === viewpoint.id) }, focusId: place.id };
}

export function availableDraftPlaces(draft: ItineraryDraftPlan, candidates: readonly SelectedPlace[], places: readonly SelectedPlace[]): readonly SelectedPlace[] {
  const merged = new Map<string, SelectedPlace>();
  for (const place of [...draft.stops.map((stop) => stop.place), ...candidates, ...places]) {
    const previous = merged.get(place.id);
    const viewpoints = new Map([...(previous?.viewpoints ?? []), ...place.viewpoints].map((viewpoint) => [viewpoint.id, viewpoint]));
    merged.set(place.id, { ...place, viewpoints: [...viewpoints.values()] });
  }
  return [...merged.values()];
}
