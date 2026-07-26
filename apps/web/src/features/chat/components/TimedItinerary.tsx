import type { ItineraryLeg, ItineraryStation, ItineraryView } from "../../../lib/chat/itinerary";
import type { ChatDict } from "../i18n";
import { legCapsule } from "../route-copy";

type DictProps = Readonly<{ dict: ChatDict }>;
type ViewProps = Readonly<{ view: ItineraryView; dict: ChatDict }>;

/** Colour alone never carries the highlight: the star names itself for AT. */
function GoldStar({ dict }: DictProps) {
  return (
    <span className="chat-itinerary__star" role="img" aria-label={dict.route.highlight}>
      ★
    </span>
  );
}

function stationTimes(station: ItineraryStation): string | undefined {
  if (station.arrive === undefined) return station.depart;
  if (station.depart === undefined || station.depart === station.arrive) return station.arrive;
  return `${station.arrive}–${station.depart}`;
}

function stopClass(station: ItineraryStation): string {
  return station.highlighted ? "chat-itinerary__stop chat-itinerary__stop--highlight" : "chat-itinerary__stop";
}

function StationRow({ station, dict }: Readonly<{ station: ItineraryStation; dict: ChatDict }>) {
  const times = stationTimes(station);
  return (
    <li className={stopClass(station)}>
      {times !== undefined ? <time className="chat-itinerary__time">{times}</time> : null}
      <span className="chat-itinerary__name">{station.name}</span>
      {station.highlighted ? <GoldStar dict={dict} /> : null}
    </li>
  );
}

function LegRow({ leg, dict }: Readonly<{ leg: ItineraryLeg; dict: ChatDict }>) {
  return (
    <li className="chat-itinerary__leg" data-mode={leg.mode}>
      <span className="chat-itinerary__capsule">{legCapsule(dict, leg)}</span>
    </li>
  );
}

function TimelineItems({ view, dict }: ViewProps) {
  return view.stations.flatMap((station, index) => {
    const leg = view.legs[index];
    const rows = [<StationRow key={`stop-${station.id}`} station={station} dict={dict} />];
    if (leg) rows.push(<LegRow key={`leg-${station.id}`} leg={leg} dict={dict} />);
    return rows;
  });
}

function PacingPill({ view, dict }: ViewProps) {
  if (view.pacing === undefined) return null;
  return (
    <span className="chat-pacing-pill" data-pacing={view.pacing}>
      {dict.route.pacing[view.pacing]}
    </span>
  );
}

function MapsCta({ view, dict }: ViewProps) {
  if (view.mapsUrl === undefined) return null;
  return (
    <a className="chat-chip" data-tone="explore" href={view.mapsUrl} target="_blank" rel="noreferrer">
      {dict.route.openMaps}
    </a>
  );
}

/** Reserved Walk-mode entry point (issue #271): a disabled seam, not a mode. */
function WalkCtaSlot({ dict }: DictProps) {
  return (
    <button type="button" className="chat-chip" data-tone="walk" data-cta="walk-mode" disabled>
      {dict.route.walkCta}
    </button>
  );
}

function CtaRow({ view, dict }: ViewProps) {
  return (
    <div className="chat-cta-row">
      <MapsCta view={view} dict={dict} />
      <WalkCtaSlot dict={dict} />
    </div>
  );
}

function Timeline({ view, dict }: ViewProps) {
  return (
    <ol className="chat-itinerary__timeline" aria-label={dict.route.timelineLabel}>
      <TimelineItems view={view} dict={dict} />
    </ol>
  );
}

/**
 * S1.5 route timeline: station-granularity HH:MM rows, one gold-star highlight,
 * walk capsules between stations, pacing pill, and the CTA row. The labelled
 * list doubles as the non-visual equivalent of the promoted map's track order.
 */
export function TimedItinerary({ view, dict }: ViewProps) {
  return (
    <div className="chat-itinerary">
      <PacingPill view={view} dict={dict} />
      <Timeline view={view} dict={dict} />
      <CtaRow view={view} dict={dict} />
    </div>
  );
}
