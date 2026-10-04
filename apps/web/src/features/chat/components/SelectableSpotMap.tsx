import { useState } from "react";
import { MAX_MAP_PINS } from "../lib/spot-clusters";
import type { LocatedSpot } from "../lib/spot-clusters";
import type { PointPlacement } from "../../bubble-map/bubble-geometry";
import type { ChatDict } from "../i18n";
import { useSpotSelection } from "../selection/use-spot-selection";
import { MapFallback } from "./ErrorStates/MapFallback";
import { PlaceMapMarker } from "./PlaceMapMarker";
import { MapFrame, useBasemap } from "./SearchMap";
import type { AttachBasemap } from "./SearchMap";

type MarkerLayerProps = Readonly<{ spots: readonly LocatedSpot[]; placements: readonly PointPlacement[]; dict: ChatDict }>;

type MarkerProps = Readonly<{ spot: LocatedSpot; placement?: PointPlacement; dict: ChatDict }>;

/** One pin per spot id; viewing and picking stay separate marker actions. */
function PlacePin({ spot, placement, dict }: MarkerProps) {
  const { selected, toggle } = useSpotSelection();
  const [viewed, setViewed] = useState(false);
  if (!placement) return null;
  return <PlaceMapMarker id={spot.id} name={spot.name} position={placement} dict={dict}
    active={viewed} selected={selected.has(spot.id)}
    onOpen={() => { setViewed(true); }} onToggle={() => { toggle(spot.id); }} />;
}

function MarkerLayer({ spots, placements, dict }: MarkerLayerProps) {
  return <div className="chat-search-map__overlay">
    {spots.map((spot, index) => <PlacePin key={spot.id} spot={spot} placement={placements[index]} dict={dict} />)}
  </div>;
}

type MapProps = Readonly<{ spots: readonly LocatedSpot[]; dict: ChatDict; attach: AttachBasemap; maxPins?: number }>;

/** C3a map whose pins share the photo cards' selection scope: each pin is a
 * PlaceMapMarker reading and writing the same stable place ids (issue #1641). */
export function SelectableSpotMap({ spots, dict, attach, maxPins = MAX_MAP_PINS }: MapProps) {
  const shown = spots.slice(0, maxPins);
  const basemap = useBasemap(shown.map((spot) => spot.coord), attach);
  if (basemap.status === "fallback") return <MapFallback dict={dict} lat={shown[0]?.coord.lat} lng={shown[0]?.coord.lng} />;
  return <MapFrame basemap={basemap} role="group" label={dict.search.mapLabel}>
    <MarkerLayer spots={shown} placements={basemap.placements} dict={dict} />
  </MapFrame>;
}
