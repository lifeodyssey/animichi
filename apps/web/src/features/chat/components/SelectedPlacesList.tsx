import { Button } from "animal-island-ui-tailwind/button";
import type { RefObject } from "react";
import type { ChatDict } from "../i18n";
import type { RemovedSelection, SelectedPlace } from "../lib/selected-places";
import { sceneGroupLabel } from "../lib/scene-group";
import { selectedPlacesCopy, selectedPlacesCount } from "../selected-places-copy";
import { SelectedPlaceRow } from "./SelectedPlaceRow";
import { SceneIcon } from "./SceneIcon";
import { useSelectedPlaceReview } from "./use-selected-place-review";

export interface SelectedPlacesListProps {
  readonly places: readonly SelectedPlace[];
  readonly dict: ChatDict;
  readonly onBack: () => void;
  readonly onChange: (places: readonly SelectedPlace[]) => void;
}

const QUIET = "[min-height:44px]! [padding-inline:12px]! [--animal-text-color:var(--color-fg)] [--animal-bg-color-secondary:var(--color-primary-soft)] focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";

function ReviewHeader({ count, dict, onBack, heading }: Readonly<{ count: number; dict: ChatDict; onBack: () => void; heading: RefObject<HTMLHeadingElement | null> }>) {
  const copy = selectedPlacesCopy(dict.locale);
  return <header className="flex items-center gap-2 pb-1"><Button type="text" htmlType="button" aria-label={copy.back} className={QUIET} onClick={onBack} icon={<SceneIcon name="back" />} /><div><h2 ref={heading} tabIndex={-1} className="text-lg font-bold leading-7 outline-primary-strong">{copy.title}</h2><p role="status" aria-atomic="true" className="text-xs leading-5 tabular-nums text-muted-fg">{selectedPlacesCount(dict.locale, "places", count)}</p></div></header>;
}

function EmptySelection({ dict, onBack }: Pick<SelectedPlacesListProps, "dict" | "onBack">) {
  const copy = selectedPlacesCopy(dict.locale);
  return <div className="grid justify-items-center gap-4 px-3 py-10"><p className="text-sm text-muted-fg">{copy.empty}</p><Button htmlType="button" className={QUIET} onClick={onBack}>{copy.browse}</Button></div>;
}

function UndoRemoval({ removed, dict, onUndo }: Readonly<{ removed: RemovedSelection | null; dict: ChatDict; onUndo: () => void }>) {
  const copy = selectedPlacesCopy(dict.locale);
  const viewpoint = removed?.place.viewpoints[0];
  const name = removed && viewpoint && removed.viewpointIndex !== undefined ? sceneGroupLabel(removed.place.name, viewpoint) : removed?.place.name ?? "";
  const message = (removed?.viewpointIndex === undefined ? copy.removed : copy.removedViewpoint).replace("{name}", name);
  return <div role="status" aria-atomic="true">{removed ? <div className="flex items-center justify-between gap-2 rounded-xl bg-primary-soft px-3 py-1"><span className="min-w-0 truncate text-sm text-primary-ink" title={message}>{message}</span><Button type="text" htmlType="button" className={`${QUIET} shrink-0 [--animal-text-color:var(--color-primary-ink)]`} onClick={onUndo}>{copy.undo}</Button></div> : null}</div>;
}

/** Controlled selection review only; browsing-position restoration stays with the caller. */
export function SelectedPlacesList(props: SelectedPlacesListProps) {
  const places = props.places.filter((place) => place.viewpoints.length > 0);
  const review = useSelectedPlaceReview(places, props.onChange);
  return <section ref={review.root} aria-label={selectedPlacesCopy(props.dict.locale).title} className="@container/review grid min-w-0 w-full gap-3 bg-paper text-fg">
    <ReviewHeader count={places.length} dict={props.dict} onBack={props.onBack} heading={review.heading} />
    {places.length ? <ul aria-label={selectedPlacesCopy(props.dict.locale).title} className="max-h-[min(400px,60dvh)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable] pr-1">{places.map((place) => <SelectedPlaceRow key={place.id} place={place} places={places} dict={props.dict} onEdit={review.apply} />)}</ul> : <EmptySelection {...props} />}
    <UndoRemoval removed={review.removed} dict={props.dict} onUndo={review.undo} />
  </section>;
}
