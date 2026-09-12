import { useEffect, useRef, useState } from "react";
import { attachBasemap } from "../../src/features/bubble-map/bubble-map-controller";
import type { BasemapStatus } from "../../src/features/bubble-map/bubble-map-controller";
import type { PointPlacement } from "../../src/features/bubble-map/bubble-geometry";
import { PlaceMapMarker } from "../../src/features/chat/components/PlaceMapMarker";
import type { PlaceMapMarkerProps } from "../../src/features/chat/components/PlaceMapMarker";
import { locatedSpots } from "../../src/features/chat/lib/spot-clusters";
import { tokyoSpots } from "./fixtures";

const spots = locatedSpots(tokyoSpots);

function useMarkerMap() {
  const ref = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<readonly PointPlacement[]>([]);
  const [status, setStatus] = useState<BasemapStatus>("loading");
  useEffect(() => ref.current ? attachBasemap({ container: ref.current, points: spots.map((spot) => spot.coord), interactive: true, onProject: setPositions, onStatus: setStatus }) : undefined, []);
  return { ref, positions, status };
}

/** Only a real-map specimen for the marker; no Chat page or place-browser state. */
export function PlaceMapMarkerPreview(props: PlaceMapMarkerProps) {
  const map = useMarkerMap();
  const [activeId, setActiveId] = useState<string | null>(props.active ? props.id : null);
  const [selected, setSelected] = useState<readonly string[]>(props.selected ? [props.id] : []);
  const toggle = (id: string) => { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); props.onToggle(); };
  return <div style={{ height: 380, width: 440, maxWidth: "100%" }} className="relative overflow-hidden rounded-2xl bg-card" role="group" aria-label={props.dict.search.mapLabel} aria-busy={map.status === "loading"}>
    <div ref={map.ref} className="absolute! inset-0!" />
    {map.status === "fallback" ? <p role="status" className="absolute inset-x-4 top-4 rounded-xl bg-paper p-3 text-sm text-fg">{props.dict.errorStates.d7Message}</p> : spots.map((spot, index) => map.positions[index] ? <PlaceMapMarker key={spot.id} {...props} id={spot.id} name={spot.id === props.id ? props.name : spot.name} position={map.positions[index]} active={activeId === spot.id} selected={selected.includes(spot.id)} onOpen={() => { setActiveId(spot.id); props.onOpen(); }} onToggle={() => { toggle(spot.id); }} /> : null)}
  </div>;
}

export function PlaceMapMarkerStates(props: PlaceMapMarkerProps) {
  const [active, setActive] = useState(props.active);
  const [selected, setSelected] = useState(props.selected);
  return <div style={{ height: 208, width: 440, maxWidth: "100%" }} className="relative rounded-2xl bg-card"><PlaceMapMarker {...props} active={active} selected={selected} onOpen={() => { setActive(true); props.onOpen(); }} onToggle={() => { setSelected((value) => !value); props.onToggle(); }} /></div>;
}
