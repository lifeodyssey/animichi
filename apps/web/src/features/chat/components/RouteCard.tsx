import type { ChatDataPart } from "@animichi/contract";
import type { ItineraryView } from "../lib/itinerary";
import { locatedSpots, toSearchSpots } from "../lib/spot-clusters";
import type { LocatedSpot } from "../lib/spot-clusters";
import type { ChatDict } from "../i18n";
import { resultsOf, routeOf } from "./Cards";
import type { IntentCardProps } from "./Cards";
import { routeStatsCopy } from "../route-copy";
import { routeSaveTarget } from "../save/save-target";
import { RouteTrailMap } from "./RouteTrailMap";
import type { AttachBasemap } from "./SearchMap";
import { ItineraryPacing, ItineraryTimeline } from "./TimedItinerary";
import { RouteActions } from "./RouteActions";
import { routePresentation } from "./route-presentation";

type RouteCardProps = IntentCardProps & Readonly<{ attach?: AttachBasemap }>;

/** Headline: the work this route walks, when the stream resolved its title. */
function RouteTitle({ part, dict }: IntentCardProps) {
  const title = routeOf(part)?.anime_title?.trim();
  const heading = title?.length ? title : dict.route.routePill;
  return <h3 className="text-xl font-extrabold leading-snug text-fg">{heading}</h3>;
}

function RouteStats({ part, dict }: Readonly<{ part: ChatDataPart; dict: ChatDict }>) {
  const route = routeOf(part);
  if (!route) return null;
  const copy = routeStatsCopy(dict, route.point_count ?? 0, route.total_walk_minutes ?? undefined);
  return <p className="chat-card__stats">{copy}</p>;
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
  return <RouteTrailMap stations={stations} dimmed={offRouteSpots(part, stations)} dict={dict} attach={attach} showBadge={false} />;
}

function RouteHeader({ part, dict, view }: IntentCardProps & Readonly<{ view: ItineraryView }>) {
  return (
    <header className="grid gap-2">
      <RouteTitle part={part} dict={dict} />
      <div className="flex flex-wrap items-center gap-3"><RouteStats part={part} dict={dict} /><ItineraryPacing view={view} dict={dict} /></div>
    </header>
  );
}

function RouteFooter({ part, dict, view }: IntentCardProps & Readonly<{ view: ItineraryView }>) {
  if (view.stations.length === 0) return null;
  return <footer className="border-t border-border-soft pt-4"><RouteActions view={view} dict={dict} save={routeSaveTarget(part, dict)} /></footer>;
}

type PlanProps = IntentCardProps & ReturnType<typeof routePresentation>;

function RoutePlan({ part, dict, view, scenes }: PlanProps) {
  return <><ItineraryTimeline view={view} scenes={scenes} dict={dict} /><RouteFooter part={part} dict={dict} view={view} /></>;
}

/** One route document: overview, map, enriched stops, then departure actions. */
export function RouteCard({ part, dict, attach }: RouteCardProps) {
  const { view, scenes } = routePresentation(part);
  return (
    <div className="grid gap-5">
      <RouteHeader part={part} dict={dict} view={view} />
      <TrailMapGate part={part} dict={dict} attach={attach} />
      <RoutePlan part={part} dict={dict} view={view} scenes={scenes} />
    </div>
  );
}
