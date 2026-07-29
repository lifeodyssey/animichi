import { LoginModal } from "../../../components/auth/LoginModal";
import type { ItineraryLeg, ItineraryStation, ItineraryView } from "../../../lib/chat/itinerary";
import type { ChatDict } from "../i18n";
import { legCapsule } from "../route-copy";
import { useSaveGate } from "../save/useSaveGate";
import type { SaveGate, SaveGateOptions } from "../save/useSaveGate";
import type { SaveTarget } from "../save/saveTarget";
import { FallbackRetryButton } from "./ErrorStates/FallbackRetryButton";

type DictProps = Readonly<{ dict: ChatDict }>;
type ViewProps = Readonly<{ view: ItineraryView; dict: ChatDict }>;
type GateProps = Readonly<{ gate: SaveGate; dict: ChatDict }>;

/** Injectable for tests; production callers rely on the defaults. */
export type ItineraryProps = ViewProps & Readonly<{ save?: SaveTarget; saveDeps?: SaveGateOptions }>;

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

/** A retryable failure stays on the card: inline copy plus a retry, never a
 * full page. A `permanent` 4xx gets copy without a retry — offering one would
 * be a loop that cannot succeed. */
function SaveError({ gate, dict }: GateProps) {
  return (
    <span className="chat-cta-row__error" role="alert">
      {dict.route.saveError}
      <FallbackRetryButton label={dict.route.saveRetry} onClick={gate.activate} className="chat-chip" />
    </span>
  );
}

function SavePermanentError({ dict }: DictProps) {
  return <span className="chat-cta-row__error" role="alert">{dict.route.savePermanentError}</span>;
}

function SaveFeedback({ gate, dict }: GateProps) {
  if (gate.status === "saved") return <span className="chat-cta-row__saved" role="status">{dict.route.saved}</span>;
  if (gate.status === "permanent") return <SavePermanentError dict={dict} />;
  if (gate.status !== "retryable") return null;
  return <SaveError gate={gate} dict={dict} />;
}

/** Saving and saved are both non-actionable: the endpoint has no dedupe key, so
 * a second tap would create a second row. `aria-busy` carries the in-flight
 * meaning that `disabled` alone would flatten into "unavailable". */
function saveDisabled(gate: SaveGate): boolean {
  return gate.action === "none" || gate.status === "saving" || gate.status === "saved";
}

/**
 * P5 save CTA (issue #273 S1.7). Cream, not gold: the design sync reserves the
 * single per-screen gold CTA for しおり共有 (「永不同屏两金」), and lists 保存する
 * under the cream press buttons. The dialog is mounted only while open, so the
 * P5 invariant is visible in the DOM rather than merely asserted.
 */
function SaveButton({ gate, dict }: GateProps) {
  const busy = gate.status === "saving";
  return (
    <button type="button" className="chat-chip" data-cta="save" disabled={saveDisabled(gate)} aria-busy={busy} onClick={gate.activate}>
      {dict.route.saveCta}
    </button>
  );
}

function SaveCta({ save, dict, saveDeps }: Omit<ItineraryProps, "view">) {
  const gate = useSaveGate(save, saveDeps);
  return (
    <>
      <SaveButton gate={gate} dict={dict} />
      <SaveFeedback gate={gate} dict={dict} />
      {gate.loginOpen ? <LoginModal open onClose={gate.closeLogin} onSendCommitted={gate.markSendCommitted} /> : null}
    </>
  );
}

function CtaRow({ view, dict, save, saveDeps }: ItineraryProps) {
  return (
    <div className="chat-cta-row">
      <MapsCta view={view} dict={dict} />
      <SaveCta save={save} dict={dict} saveDeps={saveDeps} />
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
export function TimedItinerary({ view, dict, save, saveDeps }: ItineraryProps) {
  return (
    <div className="chat-itinerary">
      <PacingPill view={view} dict={dict} />
      <Timeline view={view} dict={dict} />
      <CtaRow view={view} dict={dict} save={save} saveDeps={saveDeps} />
    </div>
  );
}
