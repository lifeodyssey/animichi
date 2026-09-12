import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { RemovedSelection, SelectedPlace, SelectionEdit } from "../lib/selected-places";
import { restoreSelected } from "../lib/selected-places";

function restoreReviewFocus(root: HTMLElement | null, heading: HTMLElement | null, target: RefObject<string | null | undefined>) {
  if (target.current === undefined) return;
  const row = [...(root?.querySelectorAll<HTMLElement>("[data-place-heading]") ?? [])].find((element) => element.dataset.placeHeading === target.current);
  (row ?? heading)?.focus({ preventScroll: true });
  target.current = undefined;
}

export function useSelectedPlaceReview(places: readonly SelectedPlace[], onChange: (places: readonly SelectedPlace[]) => void) {
  const [removed, setRemoved] = useState<RemovedSelection | null>(null);
  const root = useRef<HTMLElement>(null), heading = useRef<HTMLHeadingElement>(null), target = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => { restoreReviewFocus(root.current, heading.current, target); }, [places]);
  const apply = (edit: SelectionEdit) => { target.current = edit.focusId; setRemoved(edit.removed); onChange(edit.places); };
  const undo = () => { if (removed) apply(restoreSelected(places, removed)); };
  return { root, heading, removed, apply, undo };
}
