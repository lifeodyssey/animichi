"use client";

import dynamic from "next/dynamic";
import { useState, useMemo } from "react";
import type { RouteData, TimedItinerary } from "../../lib/types";
import { useRouteExport } from "../../hooks/useRouteExport";
import { useDict } from "../../lib/i18n-context";
import { cn } from "@/lib/utils";
import RouteTimeline from "./RouteTimeline";

// ---------------------------------------------------------------------------
// Map — lazy-loaded (Mapbox GL requires window)
// ---------------------------------------------------------------------------

const LazyBaseMap = dynamic(() => import("../map/BaseMap"), { ssr: false });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACE_MULTIPLIER: Record<"chill" | "normal" | "packed", number> = {
  chill: 1.5,
  normal: 1.0,
  packed: 0.5,
};

const EMPTY_ITINERARY: TimedItinerary = {
  stops: [],
  legs: [],
  total_minutes: 0,
  total_distance_m: 0,
  spot_count: 0,
  pacing: "normal",
  start_time: "",
  export_google_maps_url: [],
  export_ics: "",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RoutePlannerWizardProps {
  data: RouteData;
  onBack?: () => void;
  onExpandChat?: () => void;
}

// ---------------------------------------------------------------------------
// RoutePlannerWizard
// ---------------------------------------------------------------------------

export default function RoutePlannerWizard({
  data,
  onBack,
  onExpandChat,
}: RoutePlannerWizardProps) {
  const { route: rt } = useDict();
  const paceOptions = useMemo(() => [
    { key: "chill" as const, label: rt.pace_chill, desc: rt.pace_desc.replace("{min}", "45") },
    { key: "normal" as const, label: rt.pace_normal, desc: rt.pace_desc.replace("{min}", "30") },
    { key: "packed" as const, label: rt.pace_packed, desc: rt.pace_desc.replace("{min}", "15") },
  ], [rt]);
  const itinerary = data.route.timed_itinerary ?? EMPTY_ITINERARY;
  const points = data.route.ordered_points;
  const animeTitle = data.route.anime_title_cn
    ?? data.route.anime_title
    ?? points[0]?.title_cn
    ?? points[0]?.title
    ?? "";
  const coverUrl = data.route.cover_url
    ?? (points[0]?.bangumi_id
      ? `https://image.anitabi.cn/bangumi/${points[0].bangumi_id}.jpg?plan=h160`
      : null);

  const [pacing, setPacing] = useState<"chill" | "normal" | "packed">(
    itinerary.pacing,
  );
  const [activeStopId, setActiveStopId] = useState<string | undefined>();

  const { exportGoogleMaps, exportIcs } = useRouteExport(itinerary);

  // Adjusted itinerary based on pacing
  const adjustedItinerary = useMemo<TimedItinerary>(() => {
    const mult = PACE_MULTIPLIER[pacing];
    return {
      ...itinerary,
      stops: itinerary.stops.map((s) => ({
        ...s,
        dwell_minutes: Math.round(s.dwell_minutes * mult),
      })),
      total_minutes: Math.round(itinerary.total_minutes * mult),
    };
  }, [itinerary, pacing]);

  // Derived stats — use adjustedItinerary
  const spotCount = adjustedItinerary.spot_count;
  const distKm = (adjustedItinerary.total_distance_m / 1000).toFixed(1);
  const totalMin = adjustedItinerary.total_minutes;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const walkMin = adjustedItinerary.legs.reduce(
    (sum, l) => sum + l.duration_minutes,
    0,
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: Map (45%) ── */}
      <div className="relative flex-[0_0_45%] border-r border-border">
        <LazyBaseMap
          points={points}
          route={points}
          height="100%"
          scrollWheelZoom
        />
      </div>

      {/* ── Right: Timeline panel (55%) ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header bar */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 rounded-sm bg-transparent px-2 py-1 text-sm text-primary hover:bg-muted"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
              {rt.back_edit}
            </button>
          )}
          <div className="flex items-center gap-3">
            {coverUrl && (
              <img
                src={coverUrl}
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 rounded-md object-cover"
              />
            )}
            <div className="min-w-0">
              <div
                className="truncate font-display text-base font-bold text-foreground"
              >
                {animeTitle}
              </div>
              {points[0]?.title && points[0]?.title_cn && points[0].title !== points[0].title_cn && (
                <div className="truncate text-xs text-muted-foreground">
                  {points[0].title}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stats bar — narrative headline */}
        <div
          className="shrink-0 border-b border-border bg-card px-4 py-3"
        >
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div
                className="font-display text-base font-semibold text-foreground"
              >
                {rt.pilgrimage_title.replace("{count}", String(spotCount))}
              </div>
              <div
                className="mt-0.5 text-sm tabular-nums text-muted-foreground"
              >
                {rt.stats_detail
                  .replace("{h}", String(hours))
                  .replace("{m}", String(mins).padStart(2, "0"))
                  .replace("{d}", distKm)
                  .replace("{w}", String(walkMin))}
              </div>
            </div>

            {/* Pace toggle */}
            <div className="shrink-0">
              <div className="flex gap-1">
                {paceOptions.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setPacing(opt.key)}
                    className={cn("min-h-11 rounded-md border px-3 py-1 text-xs font-medium",
                      pacing === opt.key
                        ? "border-primary bg-primary text-primary-fg"
                        : "border-border bg-background text-muted-foreground"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div
                className="mt-1 text-right text-muted-foreground"
                style={{ fontSize: 11 }}
              >
                {paceOptions.find((o) => o.key === pacing)?.desc}
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable timeline */}
        <div className="flex-1 overflow-y-auto p-4">
          <RouteTimeline
            itinerary={adjustedItinerary}
            activeStopId={activeStopId}
            onStopClick={setActiveStopId}
          />
        </div>

        {/* Export bar */}
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2">
          <button
            type="button"
            onClick={exportGoogleMaps}
            className="flex h-9 min-w-11 flex-1 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-fg"
          >
            {rt.export_gmaps}
          </button>
          <button
            type="button"
            onClick={exportIcs}
            className="h-9 min-w-11 rounded-md border border-border bg-transparent px-3 text-sm text-muted-foreground"
          >
            {rt.export_ics}
          </button>
          {onExpandChat && (
            <button
              type="button"
              onClick={onExpandChat}
              className="flex h-9 min-w-11 items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-fg"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {rt.chat_label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
