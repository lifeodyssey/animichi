import { Button } from "animal-island-ui-tailwind/button";
import { useId } from "react";
import type { ChatDict } from "../i18n";
import type { DraftStop } from "../lib/itinerary-draft";
import type { SelectedPlace } from "../lib/selected-places";
import { sceneGroupLabel } from "../lib/scene-group";
import { draftStayCopy, draftViewpointCount, itineraryDraftCopy } from "../itinerary-draft-copy";
import { SelectedPlaceThumbnail } from "./SelectedPlaceThumbnail";
import { SceneIcon } from "./SceneIcon";
import { ScenePick } from "./ScenePick";
import { RemoveDraftPlace } from "./DraftPlaceControls";
import type { DraftPlaceControls } from "./DraftPlaceControls";
import { selectedPlacesCopy } from "../selected-places-copy";
import { draftAdjustmentCopy } from "../draft-adjustment-copy";

type PlaceProps = Readonly<{ place: SelectedPlace; dict: ChatDict; controls?: DraftPlaceControls }>;
type StopProps = Readonly<{ stop: DraftStop; index: number; dict: ChatDict; controls?: DraftPlaceControls; expanded: boolean; onExpand: () => void }>;
const DISCLOSURE = "[height:auto]! [min-height:44px]! [width:100%]! [padding:4px_0px]! [font-size:15px]! [line-height:1.6]! [white-space:normal]! [text-align:left]! [justify-content:flex-start]! [--animal-text-color:var(--color-fg)] [--animal-primary-color:var(--color-primary-strong)] [--animal-bg-color-secondary:transparent] focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";

function StopNumber({ index }: Pick<StopProps, "index">) {
  return <span aria-hidden="true" className="text-xs font-bold leading-5 tabular-nums text-primary-strong">{String(index + 1).padStart(2, "0")}</span>;
}

function StopImage({ place, dict }: PlaceProps) {
  const viewpoint = place.viewpoints[0] ?? { id: place.id, frames: [] };
  return <div className="w-12 shrink-0 [&>button]:[height:48px] [&>span]:[height:48px] @min-[25rem]/draft:w-14 @min-[25rem]/draft:[&>button]:[height:56px] @min-[25rem]/draft:[&>span]:[height:56px]"><SelectedPlaceThumbnail placeName={place.name} viewpoint={viewpoint} dict={dict} /></div>;
}

function StopDescription({ stop, dict }: Pick<StopProps, "stop" | "dict">) {
  const stay = draftStayCopy(dict.locale, stop.stayEstimate);
  return <div className="grid gap-1.5">
    {stop.suggestion?.trim() ? <p className="text-sm leading-6 text-muted-fg [overflow-wrap:anywhere] [text-wrap:pretty]">{stop.suggestion}</p> : null}
    {stay ? <p className="text-xs leading-5 text-muted-fg">{stay}</p> : null}
  </div>;
}

function StopMetadata({ place, dict, controls }: PlaceProps) {
  const count = controls?.availablePlaces.find((item) => item.id === place.id)?.viewpoints.length ?? place.viewpoints.length;
  const viewpoints = controls ? draftAdjustmentCopy(dict.locale).viewpoints.replace("{selected}", String(place.viewpoints.length)).replace("{total}", String(count)) : draftViewpointCount(dict.locale, place.viewpoints.length);
  const parts = [place.city, count > 1 ? viewpoints : ""].filter(Boolean);
  return parts.length ? <p className="text-xs leading-5 text-muted-fg [overflow-wrap:anywhere]">{parts.join(" · ")}</p> : null;
}

function StopSummary(props: StopProps & Readonly<{ contentId: string }>) {
  const { stop, dict, controls, expanded, onExpand, contentId } = props;
  return <div className="flex items-center gap-2 @min-[25rem]/draft:gap-3"><span className="[display:none] @min-[25rem]/draft:[display:block]"><StopNumber index={props.index} /></span><div className="relative shrink-0"><StopImage place={stop.place} dict={dict} /><span className="pointer-events-none absolute -bottom-1 -left-1 rounded-md bg-paper px-1 [display:block] @min-[25rem]/draft:[display:none]"><StopNumber index={props.index} /></span></div>
    <div className="min-w-0 flex-1"><h3 aria-label={stop.place.name}><Button data-place-heading={stop.place.id} type="text" htmlType="button" className={DISCLOSURE} aria-label={`${itineraryDraftCopy(dict.locale).details}: ${stop.place.name}`} aria-expanded={expanded} aria-controls={expanded ? contentId : undefined} onClick={onExpand}><span className="flex w-full min-w-0 items-center justify-between gap-1"><span className="[overflow-wrap:anywhere]">{stop.place.name}</span><span aria-hidden="true" data-expanded={expanded} className="shrink-0 text-muted-fg data-[expanded=true]:rotate-90 [&_svg]:size-3.5"><SceneIcon name="next" /></span></span></Button></h3><StopMetadata place={stop.place} dict={dict} controls={controls} /></div>
    {controls ? <RemoveDraftPlace label={`${selectedPlacesCopy(dict.locale).removePlace}: ${stop.place.name}`} disabled={controls.disabled} onClick={() => { controls.onRemove(stop.place); }} /> : null}
  </div>;
}

function ViewpointImages({ place, dict, controls }: PlaceProps) {
  const available = controls?.availablePlaces.find((item) => item.id === place.id) ?? place;
  return <div className={`grid gap-x-3 gap-y-4 ${available.viewpoints.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>{available.viewpoints.map((viewpoint) => <figure key={viewpoint.id} className="grid min-w-0 gap-1.5">
    <div className="[&>button]:aspect-video [&>button]:[height:auto] [&>button]:min-h-11 [&>span]:aspect-video [&>span]:[height:auto]"><SelectedPlaceThumbnail placeName={place.name} viewpoint={viewpoint} dict={dict} /></div>
    <figcaption className="flex min-w-0 items-center justify-between gap-1 text-xs leading-5 text-muted-fg"><span className="min-w-0 [overflow-wrap:anywhere]">{sceneGroupLabel(place.name, viewpoint)}</span>{controls ? <ScenePick id={viewpoint.id} label={`${dict.search.select}: ${sceneGroupLabel(place.name, viewpoint)}`} selected={place.viewpoints.some((item) => item.id === viewpoint.id)} disabled={controls.disabled} onToggle={() => { controls.onToggle(available, viewpoint); }} /> : null}</figcaption>
  </figure>)}</div>;
}

export function DraftStopRow(props: StopProps) {
  const contentId = useId();
  return <li value={props.index + 1} className="border-b border-border-soft py-3 last:border-b-0">
    <StopSummary {...props} contentId={contentId} />
    {props.expanded ? <div id={contentId} className="grid gap-4 pb-2 pt-4"><StopDescription stop={props.stop} dict={props.dict} /><ViewpointImages place={props.stop.place} dict={props.dict} controls={props.controls} /></div> : null}
  </li>;
}
