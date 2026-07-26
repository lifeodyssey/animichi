import type { LocatedSpot } from "../../../lib/chat/spotClusters";
import { pointPlacements } from "../../bubble-map/bubbleGeometry";
import type { PointPlacement } from "../../bubble-map/bubbleGeometry";
import { attachBasemap } from "../../bubble-map/bubbleMapController";
import type { ChatDict } from "../i18n";
import { MapFallback } from "./ErrorStates/MapFallback";
import { MapFrame, percentStyle, useBasemap } from "./SearchMap";
import type { AttachBasemap } from "./SearchMap";

type TrailProps = Readonly<{
  /** Route spots in walking order — pin numbers follow this order. */
  stations: readonly LocatedSpot[];
  /** Located result spots that did not make the route; rendered dimmed. */
  dimmed: readonly LocatedSpot[];
  dict: ChatDict;
  attach?: AttachBasemap;
}>;

type SpotsProps = Readonly<{ stations: readonly LocatedSpot[]; dimmed: readonly LocatedSpot[] }>;

interface TrailPlacements {
  readonly route: readonly PointPlacement[];
  readonly rest: readonly PointPlacement[];
}

/** Route and off-route spots project into ONE percent space so they align. */
function trailPlacements({ stations, dimmed }: SpotsProps): TrailPlacements {
  const all = [...stations, ...dimmed].map((spot) => spot.coord);
  const placements = pointPlacements(all);
  return { route: placements.slice(0, stations.length), rest: placements.slice(stations.length) };
}

function trackPoints(placements: readonly PointPlacement[]): string {
  return placements.map((placement) => `${String(placement.leftPct)},${String(placement.topPct)}`).join(" ");
}

function TrackLine({ placements }: Readonly<{ placements: readonly PointPlacement[] }>) {
  return (
    <svg className="chat-route-map__track" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline className="chat-route-map__line" points={trackPoints(placements)} />
    </svg>
  );
}

function DimmedPins({ spots, placements }: Readonly<{ spots: readonly LocatedSpot[]; placements: readonly PointPlacement[] }>) {
  return placements.map((placement, index) => (
    <span
      key={spots[index]?.id ?? String(index)}
      className="chat-map-pin chat-map-pin--dimmed"
      style={percentStyle(placement)}
    />
  ));
}

function OrderedPins({ spots, placements }: Readonly<{ spots: readonly LocatedSpot[]; placements: readonly PointPlacement[] }>) {
  return placements.map((placement, index) => (
    <span key={spots[index]?.id ?? String(index)} className="chat-route-pin" style={percentStyle(placement)}>
      {index + 1}
    </span>
  ));
}

/** Decorative overlay; the timeline list is the accessible walking order. */
function TrailOverlay(props: SpotsProps) {
  const { route, rest } = trailPlacements(props);
  return (
    <div className="chat-search-map__overlay" aria-hidden="true">
      <TrackLine placements={route} />
      <DimmedPins spots={props.dimmed} placements={rest} />
      <OrderedPins spots={props.stations} placements={route} />
    </div>
  );
}

function allCoords({ stations, dimmed }: SpotsProps) {
  return [...stations, ...dimmed].map((spot) => spot.coord);
}

function TrailFallback({ stations, dict }: Readonly<{ stations: readonly LocatedSpot[]; dict: ChatDict }>) {
  const first = stations[0];
  return <MapFallback dict={dict} lat={first?.coord.lat} lng={first?.coord.lng} />;
}

/**
 * S1.5 map promotion: after route generation the map draws the gold track,
 * renumbers pins in walking order, dims off-route spots, and shows the gold
 * route pill. Tile failure degrades to D7 like every other basemap surface.
 */
export function RouteTrailMap({ stations, dimmed, dict, attach = attachBasemap }: TrailProps) {
  const basemap = useBasemap(allCoords({ stations, dimmed }), attach);
  if (basemap.status === "fallback") return <TrailFallback stations={stations} dict={dict} />;
  return (
    <MapFrame basemap={basemap} role="img" label={dict.route.mapLabel}>
      <TrailOverlay stations={stations} dimmed={dimmed} />
      <span className="chat-route-pill">{dict.route.routePill}</span>
    </MapFrame>
  );
}
