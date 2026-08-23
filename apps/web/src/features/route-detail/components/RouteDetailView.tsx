import "../../../styles/route-detail.css";
import type { Locale } from "../../../i18n/locales";
import { routeDetailCopyFor } from "../lib/copy";
import type { RouteDetailCopy } from "../lib/copy";
import {
  ROUTE_DETAIL_SCHEMA_VERSION,
  deriveRouteDataState,
  isRouteEmpty,
} from "../lib/data-state";
import type { RouteDataState, RouteDetail } from "../lib/data-state";
import { EXPANDED_SHEET_PX, initialMode, useRouteMode } from "../lib/mode";
import type { RouteMode } from "../lib/mode";
import { routeProgressLabel, toRoutePins } from "../lib/pin-state";
import { GoldBar } from "./GoldBar";
import { Hero } from "./Hero";
import { MapCard } from "./MapCard";
import type { MapCardPayload } from "./MapCard";

/**
 * The route detail shell (spec-route-detail §1): appbar → hero → map card →
 * timetable → sticky dock. It illuminates elements by data (gold bar + expanded
 * map today, 完走 badge when completed) instead of switching modes. Downstream
 * cards (#266/#268/#277…) fill the map/timetable/dock slots; the shell only owns
 * the chrome and the data-illuminated states.
 */
interface RouteDetailViewProps {
  readonly detail: RouteDetail;
  readonly locale: Locale;
  readonly now: Date;
}

interface RouteBodyProps {
  readonly detail: RouteDetail;
  readonly state: RouteDataState;
  readonly copy: RouteDetailCopy;
}

function mapCardPayload(detail: RouteDetail, copy: RouteDetailCopy): MapCardPayload {
  return {
    schema_version: ROUTE_DETAIL_SCHEMA_VERSION,
    pins: toRoutePins(detail),
    progress: routeProgressLabel(detail),
    placeholder: copy.mapPlaceholder,
  };
}

function EmptySpots({ copy }: { readonly copy: RouteDetailCopy }) {
  return (
    <section aria-label="timetable" className="route-card route-panel">
      <p className="route-panel__title">{copy.emptyTitle}</p>
      <p className="route-panel__body">{copy.emptyBody}</p>
    </section>
  );
}

function TimetablePending({ copy }: { readonly copy: RouteDetailCopy }) {
  return (
    <section aria-label="timetable" role="status" className="route-card route-panel">
      <p className="route-panel__body">{copy.timetablePlaceholder}</p>
    </section>
  );
}

interface TimetableSlotProps {
  readonly detail: RouteDetail;
  readonly copy: RouteDetailCopy;
  readonly mode: RouteMode;
}

function TimetableSlot({ detail, copy, mode }: TimetableSlotProps) {
  if (isRouteEmpty(detail)) return <EmptySpots copy={copy} />;
  const sheet = mode === "expanded" ? { maxHeight: `${String(EXPANDED_SHEET_PX)}px` } : undefined;
  return (
    <div style={sheet} data-mode={mode} className="route-sheet">
      <TimetablePending copy={copy} />
    </div>
  );
}

function goldBarPayload(state: RouteDataState, detail: RouteDetail, copy: RouteDetailCopy) {
  if (state !== "today") return null;
  return { schema_version: ROUTE_DETAIL_SCHEMA_VERSION, label: copy.goldBar, href: `/walk/${detail.id}` };
}

function GoldBarSlot({ detail, state, copy }: RouteBodyProps) {
  const payload = goldBarPayload(state, detail, copy);
  if (!payload) return null;
  return <GoldBar payload={payload} />;
}

function RouteDetailBody({ detail, state, copy }: RouteBodyProps) {
  const { mode, toggle } = useRouteMode(initialMode(state));
  return (<main className="route-detail">
    <GoldBarSlot detail={detail} state={state} copy={copy} />
    <Hero detail={detail} state={state} copy={copy} />
    <MapCard payload={mapCardPayload(detail, copy)} copy={copy} mode={mode} onToggle={toggle} />
    <TimetableSlot detail={detail} copy={copy} mode={mode} />
  </main>);
}

export function RouteDetailView({ detail, locale, now }: RouteDetailViewProps) {
  const copy = routeDetailCopyFor(locale);
  const state = deriveRouteDataState(detail, now);
  return <RouteDetailBody detail={detail} state={state} copy={copy} />;
}
