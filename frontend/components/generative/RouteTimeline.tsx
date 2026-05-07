"use client";

import type { TimedItinerary, TimedStop, TransitLeg } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findLeg(
  legs: TransitLeg[],
  from: TimedStop,
  to: TimedStop,
): TransitLeg | undefined {
  return legs.find(
    (l) => l.from_id === from.cluster_id && l.to_id === to.cluster_id,
  );
}

/** Format distance: <1000 m show meters, otherwise km with 1 decimal. */
function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RouteTimelineProps {
  itinerary: TimedItinerary;
  activeStopId?: string;
  onStopClick?: (stopId: string) => void;
}

// ---------------------------------------------------------------------------
// RouteTimeline
// ---------------------------------------------------------------------------

export default function RouteTimeline({
  itinerary,
  activeStopId,
  onStopClick,
}: RouteTimelineProps) {
  const { route: rt } = useDict();
  const { stops, legs } = itinerary;

  return (
    <div className="flex flex-col">

      {stops.map((stop, idx) => {
        const nextStop = idx < stops.length - 1 ? stops[idx + 1] : null;
        const leg = nextStop ? findLeg(legs, stop, nextStop) : null;
        const isFirst = idx === 0;
        const isLast = idx === stops.length - 1;
        const isActive = stop.cluster_id === activeStopId;
        const photoUrl = stop.points[0]?.screenshot_url ?? null;
        const episode = stop.points[0]?.episode;

        /* Fix 6: active dot sizing */
        const dotSize = isActive ? 14 : isFirst ? 16 : 12;

        return (
          <div key={stop.cluster_id}>
            {/* ── Stop row ── */}
            <button
              type="button"
              className="flex w-full cursor-pointer gap-[14px] rounded-md pb-0.5 text-left transition-colors duration-150 hover:bg-card"
              onClick={() => onStopClick?.(stop.cluster_id)}
            >
              {/* Left: time column (56px, right-aligned) */}
              <div
                className="w-14 shrink-0 pt-[2px] text-right tabular-nums"
              >
                <div className="text-sm font-medium text-foreground">
                  {stop.arrive}
                </div>
                <div className="text-xs text-muted-foreground">
                  {stop.dwell_minutes} 分
                </div>
              </div>

              {/* Center: dot column (24px) */}
              <div
                className="flex w-6 shrink-0 flex-col items-center"
              >
                <div
                  className="shrink-0 rounded-full"
                  style={{
                    width: dotSize,
                    height: dotSize,
                    background: isActive
                      ? "var(--color-brand)"
                      : "var(--color-primary)",
                    zIndex: 1,
                    boxShadow: isFirst
                      ? "0 0 0 4px oklch(72% 0.100 240 / 0.15)"
                      : undefined,
                    animation: isActive
                      ? "dot-pulse 0.6s ease-out 1"
                      : undefined,
                  }}
                />
                {!isLast && (
                  <div
                    className="w-0.5 flex-1 bg-border"
                  />
                )}
              </div>

              {/* Right: content column — Fix 6: stronger active highlight */}
              <div
                className={cn("min-w-0 flex-1",
                  isActive
                    ? "rounded-md p-2 -m-2 mb-0.5"
                    : "pb-1.5"
                )}
                style={
                  isActive
                    ? { background: "oklch(94% 0.03 25)" }
                    : undefined
                }
              >
                <div className="mb-0.5 font-display text-sm font-semibold text-foreground">
                  {stop.name}
                </div>
                <div className="mb-1.5 text-xs text-muted-foreground">
                  {episode != null ? `EP ${episode} · ` : ""}
                  {rt.timeline_spots.replace("{count}", String(stop.photo_count))}
                </div>
                {photoUrl && (
                  <img
                    src={photoUrl}
                    alt={stop.name}
                    width={72}
                    height={48}
                    className="h-12 w-[72px] rounded-sm bg-muted object-cover"
                    loading="lazy"
                  />
                )}
              </div>
            </button>

            {/* ── Walk segment — Fix 5: visually prominent ── */}
            {leg && (
              <div
                className="flex gap-[14px] py-2"
              >
                {/* Left: empty 56px spacer */}
                <div className="w-14 shrink-0" />

                {/* Center: dashed line — wider + more opaque */}
                <div
                  className="flex w-6 shrink-0 justify-center"
                >
                  <div
                    style={{
                      background:
                        "repeating-linear-gradient(to bottom, oklch(35% 0.06 145 / 0.7) 0 4px, transparent 4px 8px)",
                    }}
                    className="w-[3px] min-h-7"
                  />
                </div>

                {/* Walk pill — bolder, more saturated */}
                <div
                  className="inline-flex items-center gap-1 rounded-md px-3.5 py-1.5 text-sm font-semibold"
                  style={{
                    background: "var(--color-walk-bg)",
                    color: "var(--color-walk-fg)",
                  }}
                >
                  <span className="text-base">🚶</span> {leg.duration_minutes} 分 · {fmtDist(leg.distance_m)}
                </div>
              </div>
            )}

            {/* ── Discovery card — shown for walks > 5 min ── */}
            {leg && leg.duration_minutes > 5 && (
              <div className="flex gap-[14px]">
                <div className="w-14 shrink-0" />
                <div className="flex w-6 shrink-0 justify-center">
                  <div className="w-[3px] min-h-4 opacity-30" style={{ background: "var(--color-border)" }} />
                </div>
                <div
                  className="flex-1 rounded-md p-3"
                  style={{ background: "var(--color-walk-bg)", cursor: "pointer" }}
                >
                  <p className="mb-0.5 text-sm font-medium" style={{ color: "var(--color-walk-fg)" }}>
                    {rt.timeline_nearby}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-muted-fg)" }}>
                    {rt.timeline_nearby_sub}
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
