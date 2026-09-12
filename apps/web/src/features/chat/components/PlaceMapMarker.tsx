import { Cursor } from "animal-island-ui-tailwind/cursor";
import { useId } from "react";
import type { CSSProperties } from "react";
import type { PointPlacement } from "../../bubble-map/bubble-geometry";
import type { ChatDict } from "../i18n";
import { ScenePick } from "./ScenePick";
import { usePlaceMarkerDetails } from "./use-place-marker-details";

export interface PlaceMapMarkerProps {
  readonly id: string;
  readonly name: string;
  readonly position: PointPlacement;
  readonly active: boolean;
  readonly selected: boolean;
  readonly dict: ChatDict;
  readonly onOpen: () => void;
  readonly onToggle: () => void;
}

const PIN = "pointer-events-none grid size-8 place-items-center rounded-full border border-fg/25 bg-paper text-fg shadow-sm transition-colors group-hover:border-fg group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ground-ink data-[selected=true]:border-primary data-[selected=true]:bg-primary data-[selected=true]:text-primary-ink data-[active=true]:outline-1 data-[active=true]:outline-offset-2 data-[active=true]:outline-fg/50 motion-reduce:transition-none";
const DETAILS = "flex items-center gap-1 rounded-2xl border border-border-soft bg-paper py-1 pl-3.5 pr-1 text-fg shadow-md data-[selected=true]:border-primary data-[selected=true]:bg-primary data-[selected=true]:text-primary-ink";

function markerStyle({ leftPct, topPct }: PointPlacement): CSSProperties {
  return { left: `${String(leftPct)}%`, top: `${String(topPct)}%` };
}

function isOnMap({ leftPct, topPct }: PointPlacement): boolean {
  return [leftPct, topPct].every((value) => Number.isFinite(value) && value >= 0 && value <= 100);
}

function detailStyle({ leftPct, topPct }: PointPlacement): CSSProperties {
  return { left: `clamp(12px, calc(${String(leftPct)}% - 112px), calc(100% - 236px))`,
    ...(topPct > 55 ? { bottom: `calc(${String(100 - topPct)}% + 14px)`, paddingBottom: 12 } : { top: `calc(${String(topPct)}% + 14px)`, paddingTop: 12 }) };
}

function MarkerGlyph({ selected }: Pick<PlaceMapMarkerProps, "selected">) {
  return <svg aria-hidden="true" className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {selected ? <path d="m5 12 4 4L19 6" /> : <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>}
  </svg>;
}

function MarkerDetails(props: PlaceMapMarkerProps & Readonly<{ detailId: string }>) {
  return <div id={props.detailId} className="pointer-events-auto absolute w-56 max-w-[calc(100%-1.5rem)]" style={detailStyle(props.position)}>
    <div className={DETAILS} data-selected={props.selected}><span title={props.name} className="min-w-0 flex-1 truncate text-sm font-bold">{props.name}</span>
      <ScenePick id={props.id} label={`${props.dict.search.select}: ${props.name}`} selected={props.selected} onToggle={props.onToggle} appearance="plain" /></div>
  </div>;
}

/** Click signals the viewed place; transient details provide a separate quick pick. */
export function PlaceMapMarker(props: PlaceMapMarkerProps) {
  const detailId = useId();
  const details = usePlaceMarkerDetails();
  const selection = props.selected ? props.dict.search.traySelected.replace("{count}", "1") : "";
  return <div ref={details.root} {...details.events} className="pointer-events-none absolute inset-0 z-10 data-[expanded=true]:z-20" style={{ visibility: isOnMap(props.position) ? "visible" : "hidden" }} data-active={props.active} data-expanded={details.open} data-selected={props.selected}>
    <Cursor className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2" style={markerStyle(props.position)}><button ref={details.trigger} type="button" aria-label={props.name} aria-describedby={selection ? `${detailId}-selected` : undefined} aria-current={props.active ? "location" : undefined} aria-expanded={details.open} aria-controls={details.open ? detailId : undefined} onClick={() => { details.show(); props.onOpen(); }} className="group grid size-11 place-items-center rounded-full focus-visible:outline-none"><span className={PIN} data-active={props.active} data-selected={props.selected}><MarkerGlyph selected={props.selected} /></span></button></Cursor>
    {selection ? <span id={`${detailId}-selected`} className="sr-only">{selection}</span> : null}
    {details.open ? <MarkerDetails {...props} detailId={detailId} /> : null}
  </div>;
}
