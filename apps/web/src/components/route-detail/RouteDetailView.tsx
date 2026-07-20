import type { Locale } from "../../i18n/locales";
import { routeDetailCopyFor } from "../../lib/route-detail/copy";
import type { RouteDetailCopy } from "../../lib/route-detail/copy";
import {
  ROUTE_DETAIL_SCHEMA_VERSION,
  deriveRouteDataState,
  isRouteEmpty,
} from "../../lib/route-detail/dataState";
import type { RouteDataState, RouteDetail } from "../../lib/route-detail/dataState";
import { GoldBar } from "./GoldBar";
import { Hero } from "./Hero";

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

function MapCardSlot({ expanded, copy }: { readonly expanded: boolean; readonly copy: RouteDetailCopy }) {
  const minHeight = expanded ? "18rem" : "9rem";
  return (
    <section aria-label="地図" aria-expanded={expanded} style={{ minHeight }}
      className="grid place-items-center rounded-2xl bg-[var(--color-muted)] text-[var(--color-muted-fg)]">
      {copy.mapPlaceholder}
    </section>
  );
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

function TimetableSlot({ detail, copy }: { readonly detail: RouteDetail; readonly copy: RouteDetailCopy }) {
  if (isRouteEmpty(detail)) return <EmptySpots copy={copy} />;
  return <TimetablePending copy={copy} />;
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
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      <GoldBarSlot detail={detail} state={state} copy={copy} />
      <Hero detail={detail} state={state} copy={copy} />
      <MapCardSlot expanded={state === "today"} copy={copy} />
      <TimetableSlot detail={detail} copy={copy} />
    </main>
  );
}

export function RouteDetailView({ detail, locale, now }: RouteDetailViewProps) {
  const copy = routeDetailCopyFor(locale);
  const state = deriveRouteDataState(detail, now);
  return <RouteDetailBody detail={detail} state={state} copy={copy} />;
}
