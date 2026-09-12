import { Button } from "animal-island-ui-tailwind/button";
import { useId, useState } from "react";
import type { ChatDict } from "../i18n";
import type { SceneViewpoint } from "../lib/scene-group";
import { sceneGroupLabel } from "../lib/scene-group";
import type { SelectedPlace, SelectionEdit } from "../lib/selected-places";
import { removeSelectedPlace, removeSelectedViewpoint } from "../lib/selected-places";
import { selectedPlacesCopy, selectedPlacesCount } from "../selected-places-copy";
import { SelectedPlaceThumbnail } from "./SelectedPlaceThumbnail";
import { SceneIcon } from "./SceneIcon";

type Props = Readonly<{ place: SelectedPlace; places: readonly SelectedPlace[]; dict: ChatDict; onEdit: (edit: SelectionEdit) => void }>;
const ROW = "grid [grid-template-columns:72px_minmax(0,1fr)_44px] items-center gap-2 @min-[23rem]/review:[grid-template-columns:96px_minmax(0,1fr)_44px] @min-[23rem]/review:gap-3";
const QUIET = "[min-height:44px]! [padding:0_4px]! [border-radius:10px]! [--animal-text-color:var(--color-muted-fg)] [--animal-bg-color-secondary:var(--color-primary-soft)] focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";

function RemoveButton({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return <Button type="text" htmlType="button" className={`${QUIET} [width:44px]!`} onClick={onClick} title={label} aria-label={label}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m7 7 10 10M17 7 7 17" /></svg></Button>;
}

function placeMetadata(place: SelectedPlace): string {
  const viewpointName = place.viewpoints.length === 1 && place.viewpoints[0]?.name !== place.name ? place.viewpoints[0]?.name?.trim() : undefined;
  return [place.city, viewpointName].filter(Boolean).join(" · ");
}

function PlaceDetails({ place, dict, open, onToggle, panelId }: Pick<Props, "place" | "dict"> & Readonly<{ open: boolean; onToggle: () => void; panelId: string }>) {
  const copy = selectedPlacesCopy(dict.locale), multiple = place.viewpoints.length > 1;
  const count = place.viewpoints[0]?.frames.filter((frame) => frame.url).length ?? 0;
  const details = placeMetadata(place);
  return <div className="min-w-0"><h3 data-place-heading={place.id} tabIndex={-1} className="break-words text-base font-bold leading-6 outline-primary-strong">{place.name}</h3>
    {details ? <p className="mt-1 text-xs leading-5 text-muted-fg">{details}</p> : null}
    {multiple ? <Button type="text" htmlType="button" className={`${QUIET} [max-width:100%]! [white-space:normal]! text-left`} aria-expanded={open} aria-controls={panelId} aria-label={`${open ? copy.collapse : copy.expand}: ${place.name}`} onClick={onToggle}><span className="flex items-center gap-1 text-xs leading-5">{selectedPlacesCount(dict.locale, "viewpoints", place.viewpoints.length)}<span className={open ? "-rotate-90 [&_svg]:size-3.5" : "rotate-90 [&_svg]:size-3.5"}><SceneIcon name="next" /></span></span></Button> : count > 1 ? <p className="mt-1 text-xs leading-5 text-muted-fg">{selectedPlacesCount(dict.locale, "frames", count)}</p> : null}
  </div>;
}

function ViewpointRow({ place, places, viewpoint, dict, onEdit }: Props & Readonly<{ viewpoint: SceneViewpoint }>) {
  const copy = selectedPlacesCopy(dict.locale), label = sceneGroupLabel(place.name, viewpoint);
  const count = viewpoint.frames.filter((frame) => frame.url).length;
  return <li className={`${ROW} py-2`}><SelectedPlaceThumbnail placeName={place.name} viewpoint={viewpoint} dict={dict} /><div className="min-w-0"><p className="break-words text-sm font-semibold leading-6">{label}</p>{count > 1 ? <p className="text-xs leading-5 text-muted-fg">{selectedPlacesCount(dict.locale, "frames", count)}</p> : null}</div><RemoveButton label={`${copy.removeViewpoint}: ${label}`} onClick={() => { onEdit(removeSelectedViewpoint(places, place, viewpoint)); }} /></li>;
}

export function SelectedPlaceRow(props: Props) {
  const { place, dict } = props;
  const [open, setOpen] = useState(false), panelId = useId(), first = place.viewpoints[0];
  if (!first) return null;
  return <li className="border-b border-border-soft py-4 first:pt-0 last:border-b-0"><div className={ROW}>
    <SelectedPlaceThumbnail placeName={place.name} viewpoint={first} dict={dict} /><PlaceDetails place={place} dict={dict} open={open} panelId={panelId} onToggle={() => { setOpen((value) => !value); }} /><RemoveButton label={`${selectedPlacesCopy(dict.locale).removePlace}: ${place.name}`} onClick={() => { props.onEdit(removeSelectedPlace(props.places, place)); }} />
  </div>{open && place.viewpoints.length > 1 ? <ul id={panelId} aria-label={place.name} className="mt-3 rounded-xl bg-primary-soft/40 p-2">{place.viewpoints.map((viewpoint) => <ViewpointRow key={viewpoint.id} {...props} viewpoint={viewpoint} />)}</ul> : <div id={panelId} hidden />}</li>;
}
