import type { ChatDataPart, TimedItinerary as TimedItineraryModel } from "@seichijunrei/contract";
import { itineraryView } from "../../../lib/chat/itinerary";
import { locatedSpots, toSearchSpots } from "../../../lib/chat/spotClusters";
import type { LocatedSpot } from "../../../lib/chat/spotClusters";
import type { ChatDict } from "../i18n";
import { resultsOf, routeOf, SpotList } from "./cards";
import type { IntentCardProps } from "./cards";
import { routeStatsCopy } from "../route-copy";
import { routeSaveTarget } from "../save/saveTarget";
import { RouteTrailMap } from "./RouteTrailMap";
import type { AttachBasemap } from "./SearchMap";
import { TimedItinerary } from "./TimedItinerary";

type RouteCardProps = IntentCardProps & Readonly<{ attach?: AttachBasemap }>;

function RouteStats({ part, dict }: Readonly<{ part: ChatDataPart; dict: ChatDict }>) {
  const route = routeOf(part);
  if (!route) return null;
  const copy = routeStatsCopy(dict, route.point_count ?? 0, route.total_walk_minutes ?? undefined);
  return <p className="chat-card__stats">{copy}</p>;
}

type GateProps = IntentCardProps & Readonly<{ itinerary: TimedItineraryModel | undefined }>;

/** The card owns the part, so it derives the save payload the CTA row needs. */
function ItineraryGate({ itinerary, part, dict }: GateProps) {
  if (!itinerary || itinerary.stops.length === 0) return null;
  return <TimedItinerary view={itineraryView(itinerary)} dict={dict} save={routeSaveTarget(part, dict)} />;
}

/** Route spots in walking order, restricted to rows the map can place. */
function routeStations(part: ChatDataPart): readonly LocatedSpot[] {
  const stops = routeOf(part)?.timed_itinerary?.stops ?? [];
  return locatedSpots(toSearchSpots(stops.map((stop) => ({
    id: stop.cluster_id,
    name: stop.name,
    lat: stop.lat,
    lng: stop.lng,
  }))));
}

/** Located result spots that the planner left off the route; they dim. */
function offRouteSpots(part: ChatDataPart, stations: readonly LocatedSpot[]): readonly LocatedSpot[] {
  const onRoute = new Set(stations.map((spot) => spot.id));
  const rows = resultsOf(part)?.rows ?? [];
  return locatedSpots(toSearchSpots(rows)).filter((spot) => !onRoute.has(spot.id));
}

type MapGateProps = IntentCardProps & Readonly<{ attach?: AttachBasemap }>;

function TrailMapGate({ part, dict, attach }: MapGateProps) {
  const stations = routeStations(part);
  if (stations.length === 0) return null;
  return <RouteTrailMap stations={stations} dimmed={offRouteSpots(part, stations)} dict={dict} attach={attach} />;
}

/**
 * S1.5 route card (issue #271): summary stats, the timed itinerary, the
 * promoted trail map, and the spot strip (whose stills degrade per D9).
 */
export function RouteCard({ part, dict, attach }: RouteCardProps) {
  return (
    <div className="chat-card__body">
      <RouteStats part={part} dict={dict} />
      <ItineraryGate itinerary={routeOf(part)?.timed_itinerary} part={part} dict={dict} />
      <TrailMapGate part={part} dict={dict} attach={attach} />
      <SpotList part={part} dict={dict} />
    </div>
  );
}
