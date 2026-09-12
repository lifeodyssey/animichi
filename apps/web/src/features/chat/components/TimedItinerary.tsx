import type { ItineraryLeg, ItineraryStation, ItineraryView } from "../lib/itinerary";
import type { ChatDict } from "../i18n";
import { legCapsule } from "../route-copy";
import type { SpotRow } from "./Cards";
import { RouteActions } from "./RouteActions";
import type { RouteActionProps } from "./RouteActions";
import { RouteStopScene } from "./RouteStopScene";

type DictProps = Readonly<{ dict: ChatDict }>;
type ViewProps = Readonly<{ view: ItineraryView; dict: ChatDict }>;
type TimelineProps = ViewProps & Readonly<{ scenes?: readonly SpotRow[] }>;
export type ItineraryProps = RouteActionProps;

/** Colour alone never carries the highlight: the star names itself for AT. */
function GoldStar({ dict }: DictProps) {
  return <span className="chat-itinerary__star text-base" role="img" aria-label={dict.route.highlight}>★</span>;
}

function stationTimes(station: ItineraryStation): string | undefined {
  if (station.arrive === undefined) return station.depart;
  if (station.depart === undefined || station.depart === station.arrive) return station.arrive;
  return `${station.arrive}–${station.depart}`;
}

const STOP_BASE = "chat-itinerary__stop group/stop grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3";

function stopClass(station: ItineraryStation): string {
  return station.highlighted ? `${STOP_BASE} chat-itinerary__stop--highlight` : STOP_BASE;
}

/** The rail connects map numbers without competing with the stop names. */
function StopRail({ index, last }: Readonly<{ index: number; last: boolean }>) {
  return (
    <div className="flex flex-col items-center" aria-hidden="true">
      <span className="grid size-6 flex-none place-items-center rounded-full border-2 border-paper bg-[var(--color-map-pin-teal)] text-xs font-bold tabular-nums text-[var(--color-primary-ink)]">{index + 1}</span>
      {last ? null : <span className="w-0 flex-1 border-l border-dashed border-border-soft" />}
    </div>
  );
}

function StopTime({ station }: Readonly<{ station: ItineraryStation }>) {
  const times = stationTimes(station);
  if (times === undefined) return null;
  return <time className="chat-itinerary__time">{times}</time>;
}

function StationHeading({ station, dict }: Readonly<{ station: ItineraryStation; dict: ChatDict }>) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="chat-itinerary__name min-w-0 break-words text-base font-bold leading-snug">{station.name}</span>
      {station.highlighted ? <GoldStar dict={dict} /> : null}
    </div>
  );
}

function StationDetails({ station, dict }: Readonly<{ station: ItineraryStation; dict: ChatDict }>) {
  return (
    <div className="min-w-0 space-y-1">
      <StationHeading station={station} dict={dict} />
      <StopTime station={station} />
    </div>
  );
}

type StationContentProps = Readonly<{ station: ItineraryStation; dict: ChatDict; scene?: SpotRow }>;

function StationContent({ station, dict, scene }: StationContentProps) {
  return (
    <div className="flex items-start gap-3">
      <RouteStopScene scene={scene} dict={dict} />
      <StationDetails station={station} dict={dict} />
    </div>
  );
}

function LegCopy({ leg, dict }: Readonly<{ leg?: ItineraryLeg; dict: ChatDict }>) {
  if (!leg) return null;
  return <p className="chat-itinerary__leg mt-1.5 text-xs text-muted-fg" data-mode={leg.mode}>{legCapsule(dict, leg)}</p>;
}

type StationProps = StationContentProps & Readonly<{ index: number; last: boolean; leg?: ItineraryLeg }>;

function StationBody({ station, scene, dict, leg }: StationContentProps & Readonly<{ leg?: ItineraryLeg }>) {
  return (
    <div className="min-w-0 [padding-bottom:20px] group-last/stop:[padding-bottom:0]">
      <StationContent station={station} scene={scene} dict={dict} />
      <LegCopy leg={leg} dict={dict} />
    </div>
  );
}

function StationRow({ station, index, dict, scene, last, leg }: StationProps) {
  return (
    <li className={stopClass(station)}>
      <StopRail index={index} last={last} />
      <StationBody station={station} scene={scene} dict={dict} leg={leg} />
    </li>
  );
}

function TimelineItems({ view, dict, scenes }: TimelineProps) {
  return view.stations.map((station, index) => {
    const scene = scenes?.find((row) => row.id === station.id);
    return <StationRow key={station.id} station={station} index={index} dict={dict} scene={scene} leg={view.legs[index]} last={index === view.stations.length - 1} />;
  });
}

export function ItineraryPacing({ view, dict }: ViewProps) {
  if (view.pacing === undefined) return null;
  return <span className="chat-pacing-pill" data-pacing={view.pacing}>{dict.route.pacing[view.pacing]}</span>;
}

export function ItineraryTimeline({ view, dict, scenes }: TimelineProps) {
  if (view.stations.length === 0) return null;
  return (
    <ol className="chat-itinerary__timeline" aria-label={dict.route.timelineLabel}>
      <TimelineItems view={view} dict={dict} scenes={scenes} />
    </ol>
  );
}

/** Standalone presentation; RouteCard composes these sections around its map. */
export function TimedItinerary({ view, dict, save, saveDeps }: ItineraryProps) {
  return (
    <div className="chat-itinerary">
      <ItineraryPacing view={view} dict={dict} />
      <ItineraryTimeline view={view} dict={dict} />
      <RouteActions view={view} dict={dict} save={save} saveDeps={saveDeps} />
    </div>
  );
}
