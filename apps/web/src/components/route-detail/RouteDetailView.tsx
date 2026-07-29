import type { Locale } from "../../i18n/locales";
import { routeDetailCopyFor } from "../../lib/route-detail/copy";
import type { RouteDetailCopy } from "../../lib/route-detail/copy";
import {
  ROUTE_DETAIL_SCHEMA_VERSION,
  deriveRouteDataState,
  isRouteEmpty,
} from "../../lib/route-detail/dataState";
import type { RouteDataState, RouteDetail } from "../../lib/route-detail/dataState";
import { EXPANDED_SHEET_PX, initialMode, useRouteMode } from "../../lib/route-detail/mode";
import type { RouteMode } from "../../lib/route-detail/mode";
import { routeProgressLabel, toRoutePins } from "../../lib/route-detail/pinState";
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
    <section aria-label="timetable" className="flex flex-col gap-1 rounded-2xl bg-[var(--color-card)] p-5">
      <p className="m-0 font-bold text-[var(--color-fg)]">{copy.emptyTitle}</p>
      <p className="m-0 text-[var(--color-muted-fg)]">{copy.emptyBody}</p>
    </section>
  );
}

function TimetablePending({ copy }: { readonly copy: RouteDetailCopy }) {
  return (
    <section aria-label="timetable" role="status" className="rounded-2xl bg-[var(--color-card)] p-5 text-[var(--color-muted-fg)]">
      {copy.timetablePlaceholder}
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
  const sheet = mode === "expanded" ? { maxHeight: `${String(EXPANDED_SHEET_PX)}px`, overflowY: "auto" as const } : undefined;
  return (
    <div style={sheet} data-mode={mode}>
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
  return (<main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
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
